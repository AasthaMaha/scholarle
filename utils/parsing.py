import json


def safe_json_parse(text: str):
    try:
        return json.loads(text)
    except:
        start = text.find("{")
        end = text.rfind("}") + 1
        return json.loads(text[start:end])