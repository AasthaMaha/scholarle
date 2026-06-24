from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from backend_auth.database import get_db
from backend_auth.models import GoogleAccount, User
from backend_auth.security import (
    create_access_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)
from config import settings


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


def google_email_for(user: User) -> str | None:
    return user.google_accounts[0].google_email if user.google_accounts else None


def auth_response(user: User) -> dict:
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "google_email": google_email_for(user),
        },
    }


@router.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> dict:
    email = payload.email.lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        name=payload.name.strip(),
        email=email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return auth_response(user)


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    email = payload.email.lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    return auth_response(user)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "google_email": google_email_for(current_user),
    }


@router.get("/google/start")
def google_start(token: str = Query(...)) -> RedirectResponse:
    if not settings.google_client_id or not settings.google_redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured.",
        )

    payload = decode_token(token)
    state = jwt.encode(
        {
            "sub": payload["sub"],
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.jwt_secret_key,
        algorithm="HS256",
    )
    params = urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if not all([
        settings.google_client_id,
        settings.google_client_secret,
        settings.google_redirect_uri,
    ]):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured.",
        )

    payload = decode_token(state)
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    async with httpx.AsyncClient(timeout=15) as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        tokens = token_response.json()

        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_response.raise_for_status()
        userinfo = userinfo_response.json()

    expires_at = None
    if tokens.get("expires_in"):
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(tokens["expires_in"]))

    google_email = userinfo.get("email")
    if not google_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account did not return an email address.",
        )

    account = (
        db.query(GoogleAccount)
        .filter(GoogleAccount.user_id == user.id)
        .filter(GoogleAccount.google_email == google_email)
        .first()
    )
    if not account:
        account = GoogleAccount(user_id=user.id, google_email=google_email, access_token="")
        db.add(account)

    account.access_token = tokens["access_token"]
    account.refresh_token = tokens.get("refresh_token") or account.refresh_token
    account.expires_at = expires_at
    db.commit()

    return RedirectResponse(f"{settings.frontend_url}/auth?google_connected=1")
