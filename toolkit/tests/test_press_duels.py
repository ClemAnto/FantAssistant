"""Tests for the THIRD judge: the published ballottaggi (`press.parse_duels_article`, `judge_duels`).

Why these assertions and not others. The article that carries them does NOT carry the modules - verified
twice by downloading it, «modulo», «3-5-2» and «4-3-3» appear zero times because the eleven is a graphic -
and the numbers once reported on that comparison were RETRACTED because they came from a fetch summary that
had DEDUCED them. So what a test has to protect is: the fields are taken by LABEL and not by position (the
page is re-published and the order of the paragraphs is not a promise), a group of three is kept as a group
of three, and the names stay verbatim - a name normalised at archive time is a name lost.
"""

from __future__ import annotations

from euroleghe_ingest.modules import press

ARTICLE = """
<h2>La probabile formazione dell'Atalanta 2026/27</h2>
<p>Movimenti pi&ugrave; importanti: Kristensen (nuovo)</p>
<p>In bilico : De Ketelaere, Scalvini</p>
<p>Ballottaggi : Kristensen-Kossounou, De Ketelaere-Sulemana-Zalewski</p>
<p>Rigoristi : Scamacca, Krstovic</p>
<p>Punizioni e calci piazzati : De Ketelaere</p>
<p>Giovani in rampa di lancio : Ljubo Puljic</p>
<h2>La probabile formazione del Bologna 2026/27</h2>
<p>Rigoristi: Orsolini</p>
<p>Ballottaggi : Skorupski-Pessina</p>
<h2>Ultimi commenti</h2>
"""


def test_one_entry_per_club_and_the_fields_are_taken_by_label():
    entries = press.parse_duels_article(ARTICLE)
    assert [one["club"] for one in entries] == ["Atalanta", "Bologna"]
    # Il Bologna ha i rigoristi PRIMA dei ballottaggi: se si leggesse per posizione, si perderebbe.
    assert entries[1]["duels"] == [["Skorupski", "Pessina"]]


def test_a_three_way_ballottaggio_stays_a_GROUP_of_three():
    """«A-B-C» dice che tre si giocano un posto, non che ci sono tre duelli slegati."""
    atalanta = press.parse_duels_article(ARTICLE)[0]
    assert atalanta["duels"] == [["Kristensen", "Kossounou"],
                                ["De Ketelaere", "Sulemana", "Zalewski"]]


def test_the_other_fields_travel_as_notes_and_the_names_are_verbatim():
    atalanta = press.parse_duels_article(ARTICLE)[0]
    import json
    notes = json.loads(atalanta["notes"])
    assert notes["rigoristi"] == ["Scamacca", "Krstovic"]
    assert notes["in_bilico"] == ["De Ketelaere", "Scalvini"]
    assert notes["punizioni_e_calci_piazzati"] == ["De Ketelaere"]
    # ...e il modulo NON c'e', che e' il fatto centrale su questa fonte: la conferma sta in `confidence`.
    assert "graphic" in atalanta["confidence"]


def test_a_club_without_ballottaggi_is_not_an_entry_at_all():
    """Una sezione che non porta il campo per cui la fonte esiste non diventa una riga vuota."""
    assert press.parse_duels_article("<h2>La probabile formazione del Lecce 2026/27</h2><p>ciao</p>") == []
    assert press.parse_duels_article("<h2>Ultime novita' mercato</h2>") == []


def test_the_judge_needs_a_null_and_reports_what_it_could_not_resolve():
    """Senza DB: si controlla la forma del verdetto, che e' quello che il report promette."""
    verdict = press.judge_duels(_NoRows(), {}, {}, "2026-27")
    assert verdict["clubs"] == 0 and verdict["shared"] == 0
    # Un verdetto senza null non e' interpretabile: le chiavi ci devono essere anche a zero club.
    assert "null" in verdict and "recall" in verdict and "precision" in verdict
    assert verdict["unresolved"] == 0


class _NoRows:
    """Il minimo che `judge_duels` chiama su una connessione quando non c'e' niente da confrontare."""

    def execute(self, *_args, **_kwargs):
        return self

    def fetchall(self):
        return []
