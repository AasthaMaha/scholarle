def save(text, filename="proposal.md"):
    with open(filename, "w") as f:
        f.write(text)