"""Builds a graded-CD eBay title. Reads JSON on stdin, prints JSON."""
import json
import re
import sys

TITLE_MAX = 80
SHORT = {"mint": "M", "near mint": "NM", "very good+": "VG+", "very good": "VG",
         "good": "G", "fair": "F", "poor": "P", "missing": "Missing"}


def _grade(value, allow_missing=False):
    if value is None:
        return None
    key = " ".join(value.split()).lower()
    if key not in SHORT or (key == "missing" and not allow_missing):
        raise ValueError(f"Unknown grade: {value!r}. Use one of: {', '.join(SHORT)}")
    return key


def _long_condition(disc, booklet):
    parts = []
    if disc:
        parts.append(f"Disc: {disc.title()}")
    if booklet:
        parts.append(f"Inlay: {booklet.title()}")
    return f"({' / '.join(parts)})" if parts else ""


def _fit(album, suffix, extras, single):
    """Adds extras in priority order. Returns (name, added indexes, dropped terms)."""
    name, added, dropped = album, set(), []
    for index, raw in enumerate(extras):
        forms = [" ".join(re.sub(r"[()]", "", f).split()) for f in raw.split("||")]
        if re.search(r"\brare\b", name, re.I):
            forms = [" ".join(re.sub(r"\brare\b", "", f, flags=re.I).split()) for f in forms]
        if single and any(re.fullmatch(r"double cd|([2-9]|\d\d)\s*-?\s*(x\s*)?cds?", f, re.I) for f in forms):
            dropped.append(forms[0])  # contradicts the disc count: say so
            continue
        forms = [f for f in forms
                 if f and not re.fullmatch(r"rare|compact disc|cds?|double cd|\d\s*-?\s*(x\s*)?cds?", f, re.I)]
        have = set(re.split(r"[\s/()]+", f"{name} {suffix}".lower()))
        forms_new = [f for f in forms if not set(f.lower().split()) <= have]
        if not forms or len(forms_new) < len(forms):
            continue  # nothing usable, or the title already says it
        fitting = next((f for f in forms if len(f"{name} {f} {suffix}") <= TITLE_MAX), None)
        if fitting:
            name = f"{name} {fitting}"
            added.add(index)
        else:
            dropped.append(forms[0])
    return name, added, dropped


def build_title(album, disc, booklet, sealed=False, extras=[], discs=1):
    album = re.sub(r"[\s\-–,]*\b(compact disc|\d?\s*cds?)\b\s*$", "", " ".join(album.split()), flags=re.I)
    disc = _grade(disc)
    booklet = _grade(booklet, allow_missing=True)
    if not re.fullmatch(r"[1-9]\d?", str(discs)):
        raise ValueError(f"discs must be a whole number from 1, got {discs!r}")
    discs = int(discs)
    fmt = f"{discs}CD" if discs > 1 else "CD"
    condition = "(Sealed)" if sealed else _long_condition(disc, booklet)

    def attempt(cond):
        suffix = f"{fmt} {cond}".strip()
        name, added, dropped = _fit(album, suffix, extras, discs == 1)
        title = f"{name} {suffix}"
        return {"title": title, "added": added, "dropped": dropped, "fits": len(title) <= TITLE_MAX}

    chosen, short = attempt(condition), False
    if not sealed and disc and booklet:
        alt = attempt(f"({SHORT[disc]}/{SHORT[booklet]})")
        keeps_more = alt["added"] > chosen["added"]  # every long-form term, plus at least one
        if alt["fits"] and (not chosen["fits"] or keeps_more):
            chosen, short = alt, True
    return {"title": chosen["title"], "short_grades": short,
            "dropped": chosen["dropped"], "fits": chosen["fits"]}


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        print(json.dumps(build_title(
            data["album"], data.get("disc"), data.get("booklet"), data.get("sealed", False),
            data.get("extras", []), data.get("discs", 1))))
    except (ValueError, KeyError) as err:
        sys.exit(f"title.py: {err}")
