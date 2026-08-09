"""Identity resolution: external provider names -> fc_id / fc_club_id.

fc_id is the primary key, so every external source (SofaScore today, FBref later) has to be pinned
to it. The two name conventions are very different:

    ours (fantacalcio.it)   'Zapata D.'   'Pellegrini Lo.'   'N'Dicka'   'Ikon��'
    provider                'Duvan Zapata' 'Lorenzo Pellegrini' 'Evan Ndicka' 'Jonathan Ikone'

so the matcher works on a normalized form (accents folded, punctuation dropped) and applies TIERED
rules, from strict to loose, inside a POOL that is itself narrowed from club to league to season.
A tier only produces a match when it is UNIQUE in the pool: ties are reported, never guessed.

Two source quirks drive the odd details:
- the 2023-24/2024-25 CSVs lost accented characters byte by byte, so one accent shows up as a RUN of
  U+FFFD ('Ikon��' = 'Ikone'); a run of k of them matches 1..k characters.
- a one-token provider name ('Sulemana') has no first name, so our trailing initial ('Sulemana I.')
  cannot be checked and must not be required.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Characters NFKD does not decompose but that the two sources spell differently.
_FOLD = str.maketrans({"ð": "d", "Ð": "D", "đ": "d", "Đ": "D", "ø": "o", "Ø": "O", "ı": "i",
                       "ł": "l", "Ł": "L", "þ": "th", "æ": "ae", "Æ": "AE", "œ": "oe", "ß": "ss"})
_LOST = "�"                                    # accent lost at the source (one byte each)
# Trailing initials, either abbreviated ("Zapata D.", "Pellegrini Lo.") or a run of single letters
# ("Esposito F.P." = Francesco Pio). Without the second form the base keeps the initials as tokens
# and the surname never lines up with the provider's full name.
_INITIAL = re.compile(r"\s+((?:[A-Za-z�]\.){2,3}|[A-Za-z�]{1,3}\.)$")
_FUZZY_MIN = 0.88                                   # last-resort ratio, club pool only

# Our canonical club name -> the provider's name for the same club. Only the ones that differ:
# everything else matches after normalization. The Italian exonyms (Lipsia, Stoccarda, Lilla, ...)
# make an explicit map safer than fuzzy matching, which would happily pair 'Monaco' (AS Monaco)
# with 'Bayern Monaco'.
CLUB_ALIASES: dict[str, str] = {
    # Serie A
    "Milan": "AC Milan", "Roma": "AS Roma", "Napoli": "SSC Napoli", "Verona": "Hellas Verona",
    # Premier League
    "Brighton": "Brighton & Hove Albion", "Liverpool": "Liverpool FC",
    "Newcastle": "Newcastle United", "Tottenham": "Tottenham Hotspur",
    "West Ham": "West Ham United", "Wolverhampton": "Wolverhampton",
    "Nottingham": "Nottingham Forest",
    # LaLiga
    "Athletic Bilbao": "Athletic Club", "Barcellona": "FC Barcelona", "Betis": "Real Betis",
    "Siviglia": "Sevilla", "Atletico Madrid": "Atletico Madrid", "Alaves": "Deportivo Alaves",
    # Bundesliga
    "Bayer Leverkusen": "Bayer 04 Leverkusen", "Bayern Monaco": "FC Bayern Munchen",
    "Eintracht": "Eintracht Frankfurt", "Eintracht Francoforte": "Eintracht Frankfurt",
    "Lipsia": "RB Leipzig", "Stoccarda": "VfB Stuttgart", "Union Berlino": "1. FC Union Berlin",
    "Friburgo": "SC Freiburg", "Colonia": "1. FC Koln", "Amburgo": "Hamburger SV",
    "Borussia M'Gladbach": "Borussia M'gladbach", "Werder Brema": "SV Werder Bremen",
    "Magonza": "1. FSV Mainz 05", "Augsburg": "FC Augsburg", "Wolfsburg": "VfL Wolfsburg",
    # Ligue 1
    "Lens": "RC Lens", "Lilla": "Lille", "Monaco": "AS Monaco",
    "Olympique Lione": "Olympique Lyonnais", "Olympique Marsiglia": "Olympique de Marseille",
    "Paris Saint Germain": "Paris Saint-Germain", "Rennes": "Stade Rennais",
    # Both listone spellings, and the second one is the row `clubs` actually holds: with only
    # "Strasburgo" here the alias never fired, `club_key` read `racing strasburgo` against the
    # provider's `strasbourg`, and the club got no `club_xref` id at all - so the extra layer,
    # which fetches per club id, left its 23 quoted men with no pre-season match (09/08/2026).
    "Strasburgo": "RC Strasbourg", "Racing Strasburgo": "RC Strasbourg",
    "Nizza": "Nice", "Marsiglia": "Olympique de Marseille",
    "Lione": "Olympique Lyonnais", "Brest": "Stade Brestois", "Reims": "Stade de Reims",
}

# Corporate tokens that only one of the two sources spells out.
_CLUB_NOISE = {"fc", "ac", "as", "ss", "ssc", "cf", "sc", "sv", "vfb", "vfl", "tsg", "rb", "rc",
               "us", "usl", "afc", "cd", "ud", "sd", "club", "calcio", "de", "the"}


def fold(text: str | None) -> str:
    """Lowercase, accent-folded, punctuation-free form used for every comparison."""
    text = (text or "").translate(_FOLD)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(rf"[^a-z0-9{_LOST} ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def split_initial(name: str | None) -> tuple[str, str | None]:
    """Our style 'Zapata D.' -> ('zapata', 'd') · 'Pellegrini Lo.' -> ('pellegrini', 'lo')."""
    match = _INITIAL.search(name or "")
    base = fold(name[:match.start()] if match else name)
    # the dots fold to spaces ("F.P." -> "f p"), but a set of initials is one token: "fp"
    return base, (fold(match.group(1)).replace(" ", "") if match else None)


def lossy_eq(ours: str, theirs: str) -> bool:
    """Equality where a run of k U+FFFD in OUR string matches 1..k of their characters."""
    if _LOST not in ours:
        return ours == theirs
    pattern = re.sub(rf"{_LOST}+", lambda m: f".{{1,{len(m.group(0))}}}",
                     re.escape(ours).replace("\\" + _LOST, _LOST))
    return re.fullmatch(pattern, theirs) is not None


def _initial_agrees(initial: str, their_tokens: list[str]) -> bool:
    """Does our abbreviated first name agree with the provider's given names?

    One initial is compared to the first given name as a prefix ('D.' vs 'Duvan'). SEVERAL initials
    are a full set of given names ('F.P.' = Francesco Pio), and providers pick and order them freely
    ('Pio Esposito'), so any of our letters matching the start of any of their given names is enough
    - the surname still has to match on its own, and a tie between two namesakes is still refused.
    """
    given = their_tokens[:-1] or their_tokens[:1]
    if len(initial) == 1:
        return any(lossy_eq(initial, token[:1]) for token in given)
    if lossy_eq(initial, their_tokens[0][:len(initial)]):
        return True                                   # 'Lo.' vs 'Lorenzo'
    return any(lossy_eq(letter, token[:1]) for letter in initial for token in given)


def match_in_pool(provider_name: str, pool) -> tuple[int, list[tuple[int, str]]]:
    """Best (lowest) tier that yields candidates for `provider_name`, and those candidates.

    `pool` = iterable of (fc_id, our_name, base, initial) as produced by `build_pool_entry`.
    Tiers: 1 surname/tail match · 2 squashed-name match · 3 single-token match · 4 fuzzy.
    Returns (0, []) when nothing matches.
    """
    theirs = fold(provider_name)
    their_tokens = theirs.split()
    if not their_tokens:
        return 0, []

    # Some sources use OUR OWN convention (fantacalcio.it's own editorial lists: "Fofana Y.").
    # Then there is no full name to take a tail from - compare surname to surname and initial to
    # initial, which is the strongest evidence there is.
    their_base, their_initial = split_initial(provider_name)
    if their_initial is not None:
        same_convention = [
            (fc_id, our_name)
            for fc_id, our_name, base, initial in pool
            if base and lossy_eq(base, their_base)
            and (initial is None or lossy_eq(initial, their_initial))
        ]
        if same_convention:
            return 1, same_convention
    their_squash = theirs.replace(" ", "")
    tiers: dict[int, list[tuple[int, str]]] = {}
    for fc_id, our_name, base, initial in pool:
        if not base:
            continue
        our_tokens = base.split()
        our_squash = base.replace(" ", "")
        tail = " ".join(their_tokens[-len(our_tokens):])
        # A one-token provider name carries no first name -> the initial cannot be checked.
        if initial is not None and len(their_tokens) > 1 \
                and not _initial_agrees(initial, their_tokens):
            continue
        if lossy_eq(base, tail) or lossy_eq(base, theirs):
            tiers.setdefault(1, []).append((fc_id, our_name))
        elif lossy_eq(our_squash, their_squash) or (len(our_squash) >= 5
                                                   and their_squash.endswith(our_squash)):
            tiers.setdefault(2, []).append((fc_id, our_name))   # "N'Dicka" vs 'Evan Ndicka'
        elif len(our_tokens[-1]) >= 4 and lossy_eq(our_tokens[-1], their_tokens[-1]):
            tiers.setdefault(3, []).append((fc_id, our_name))
        elif len(our_tokens) > 1 and len(our_tokens[0]) >= 4 \
                and lossy_eq(our_tokens[0], their_tokens[0]):
            tiers.setdefault(3, []).append((fc_id, our_name))   # 'Arthur Melo' vs 'Arthur'
        elif max(SequenceMatcher(None, base, tail).ratio(),
                 SequenceMatcher(None, base, theirs).ratio()) >= _FUZZY_MIN:
            tiers.setdefault(4, []).append((fc_id, our_name))
    for tier in sorted(tiers):
        return tier, tiers[tier]
    return 0, []


def build_pool_entry(fc_id: int, our_name: str) -> tuple[int, str, str, str | None]:
    base, initial = split_initial(our_name)
    return (fc_id, our_name, base, initial)


def club_key(name: str | None) -> str:
    """Comparable club key: folded, corporate tokens and digits dropped ('AC Milan' -> 'milan')."""
    tokens = [t for t in fold(name).split() if t not in _CLUB_NOISE and not t.isdigit()]
    return " ".join(tokens) or fold(name)


def club_identity(name: str | None) -> str:
    """The ONE key two of our own spellings of a club must share. `club_key` is not enough for that.

    `club_key` is deliberately conservative - it is what the exact pass and the caches are keyed on - so
    it reads `Newcastle` and `Newcastle United` as two clubs, and `Eintracht` and `Eintracht Francoforte`
    as two more. That is exactly how `clubs` ended up with twin rows for one club (found 05/08/2026): the
    listone's seasons on one, the provider's `club_xref` on the other, and every club-level channel split
    between them - today's Eintracht with zero coach spells, `penalty_hierarchy` halved, the live squad
    dark on both.

    The fix needs no new table: `CLUB_ALIASES` already states that both spellings mean one provider club,
    so routing through it before taking the key collapses them. Use this wherever a club NAME becomes an
    identity (creating a club row, grouping club rows); keep `club_key` where a key is just a key.
    """
    return club_key(CLUB_ALIASES.get(name or "", name or ""))


# Club-form words the OFFICIAL name spells out and a fantacalcio listone never does. Stripped from
# BOTH sides, so the comparison stays symmetric, and only inside `match_club` - `club_key` itself must
# stay conservative because it is what the exact pass and the caches are keyed on.
# Measured need: without this, ten clubs of the euro perimeter - Fiorentina, Genoa, PSG, Lilla, Betis,
# West Ham, Hoffenheim, ... - never matched Transfermarkt's competition table, which is what feeds
# club_xref, and therefore lost their coach spells, their transfer fees and their injury ids.
_CLUB_FORMS = {"acf", "cfc", "losc", "ogc", "rcd", "fsv", "sco", "aj", "ca", "bsc", "estac", "sad",
               "stade", "real", "deportivo", "balompie", "olympique", "olympiakos", "athletic",
               "hove", "albion", "borussia", "eintracht", "werder", "united"}


def _strip_forms(key: str) -> str:
    tokens = [token for token in key.split() if token not in _CLUB_FORMS]
    return " ".join(tokens) or key


def match_club(name: str | None, index: dict[str, int]) -> tuple[str, int] | None:
    """Resolve a club name against `index` (club_key -> id). Returns (how, id), or None.

    Same discipline as the player matcher: ordered passes from strongest to weakest, and **a pass
    counts only if its answer is unique**. Two clubs answering the same weakened key is a namesake
    risk, not a match - 'Deportivo A Coruna' and 'Deportivo Alaves' must both fail rather than one of
    them win by iteration order.

    Passes: exact key · form words stripped from both sides · fuzzy 0.88. `index` should already carry
    the alias spellings.
    """
    key = club_key(name)
    if not key:
        return None
    if key in index:
        return "exact", index[key]

    stripped: dict[str, list[int]] = {}
    for candidate, club_id in index.items():
        stripped.setdefault(_strip_forms(candidate), []).append(club_id)
    mine = _strip_forms(key)

    hits = stripped.get(mine, [])
    if len(set(hits)) == 1:
        return "forms", hits[0]

    # NO subset pass, and the reason is worth keeping: it was written, measured against the real
    # competition tables, and it produced two WRONG clubs. 'Paris FC' became Paris Saint-Germain (a
    # different club sharing a city) and 'RCD Espanyol Barcellona' became Barcellona - because our
    # perimeter has no Espanyol at all, and uniqueness cannot protect against a pool that is missing
    # the right answer. Only strictness can. Word-containment is therefore not evidence about clubs.
    close = {index[candidate] for candidate in index
             if SequenceMatcher(None, mine, _strip_forms(candidate)).ratio() >= _FUZZY_MIN}
    if len(close) == 1:
        return "fuzzy", next(iter(close))
    return None


# The abbreviations the algorithm below cannot produce or cannot keep unique. Kept small and explicit:
# five pairs of single-word names that share a three-letter prefix, plus the one club whose conventional
# short form is not derivable from its words. A test asserts that no two clubs in the perimeter collide,
# so a new arrival that clashes fails loudly and gets an entry here instead of silently shadowing another.
CLUB_ABBREVIATIONS: dict[str, str] = {
    "mainz": "MAIN", "maiorca": "MAIO",
    "monaco": "MONA", "monza": "MONZ",
    "cardiff": "CARD", "carpi": "CARP",
    "valencia": "VALE", "valladolid": "VALL",
    "wolfsburg": "WOLF", "wolverhampton": "WOLV",
    "paris saint germain": "PSG",
}


def club_abbreviation(name: str | None) -> str:
    """Short display code for a club: 'Atalanta' -> ATA, 'Manchester United' -> MUN, 'Schalke 04' -> S04.

    One word gives its first three letters; several give one letter each, padded from the last word when
    that leaves fewer than three. Hyphens split like spaces, which is what makes Paris Saint-Germain
    three words. Accents are folded first, so 'Alavés' and 'Leganés' behave like any other name.

    Deliberately a pure function of the name, not of the set of clubs on screen: the same club must read
    the same in every view, so genuine clashes are resolved by the table above rather than by whoever
    happens to be displayed next to it.
    """
    if not name:
        return ""
    folded = fold(name).replace("-", " ")
    if folded in CLUB_ABBREVIATIONS:
        return CLUB_ABBREVIATIONS[folded]
    words = [word for word in folded.split() if word]
    if not words:
        return ""
    if len(words) == 1:
        return words[0][:3].upper()
    code = "".join(word[0] for word in words)
    if len(code) < 3:                    # 'Manchester City' -> 'MC' -> pad from 'City' -> 'MCI'
        code += words[-1][1:1 + (3 - len(code))]
    return code[:3].upper()
