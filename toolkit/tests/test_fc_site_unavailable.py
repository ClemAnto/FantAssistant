"""A section is read from the header that NAMES it, and it stops at the next header.

Two defects of one shape, both found on 01/09/2026 while checking Yildiz's injury against the source.

The first is a page that moved: until 26/08/2026 all three headers of the indisponibili card were
`<strong class="label">`, and on 01/09 the injured one became an `<a class="label">` inside
`<div class="aa-infirmary-label">`. `strong.label` still matched the two lists that had NOT moved, so
the run reported «1/1 resolved [suspended=1]» - a success line - while the injured list of a page
naming 40 men went to ZERO. Same family as the `_PLAYER_HREF` change of 05/08/2026.

The second was already there and nobody could see it: an empty section carries no <ul> at all (the
site writes `<div class="empty-list-message">Nessuno</div>`), so `find_next_sibling("ul")` walked
past its own section and took the NEXT one's list. Measured over the 20 cached pages, 50 of the 611
lists were attributed that way, every one of them a `squalificati` header taking the `diffidati`
list - and 35 men were still being read as SUSPENDED by today's sheet off a 4 August page on which
they were merely one booking away.
"""

from __future__ import annotations

from euroleghe_ingest.modules import fc_site

# The shape served until 26/08/2026: the three headers are <strong class="label">.
_OLD_SHAPE = """
<html><body><div class="team-card">
  <header class="team-info"><span class="team-name">Juventus</span></header>
  <div class="row"><div class="col">
    <header><strong class="label label-primary">Infortunati</strong></header>
    <ul class="unstyled">
      <li><strong class="item-name">Gatti</strong><div class="item-description"><p>al ginocchio</p></div></li>
    </ul>
  </div><div class="col">
    <header><strong class="label label-danger">Squalificati</strong></header>
    <div class="empty-list-message">Nessuno</div>
    <header class="mt-6"><strong class="label label-warn">Diffidati</strong></header>
    <ul class="unstyled">
      <li><strong class="item-name">Locatelli</strong></li>
    </ul>
  </div></div>
</div></body></html>
"""

# The shape served from 01/09/2026: only the INJURED header changed, which is what made it invisible.
_NEW_SHAPE = _OLD_SHAPE.replace(
    '<strong class="label label-primary">Infortunati</strong>',
    '<div class="aa-infirmary-label label p-0">'
    '<a class="h6 label label-secondary"><img class="infirmary-label"/>Infortunati<hr class="vert"/></a>'
    "</div>")


def _by_status(html):
    out = {}
    for record in fc_site.parse_unavailable(html):
        out.setdefault(record["status"], []).append(record["name"])
    return out


def test_the_injured_are_read_in_both_shapes_of_the_page():
    """The word is what the reader sees; the tag carrying it is the site's to change."""
    for name, html in (("old", _OLD_SHAPE), ("new", _NEW_SHAPE)):
        assert _by_status(html).get("injured") == ["Gatti"], f"{name} shape lost the injured list"


def test_an_empty_section_does_not_swallow_the_next_ones_list():
    """«Squalificati: Nessuno» must stay empty, not inherit the diffidati that follow it."""
    for name, html in (("old", _OLD_SHAPE), ("new", _NEW_SHAPE)):
        found = _by_status(html)
        assert "suspended" not in found, f"{name}: a booking risk was stored as a ban"
        assert found.get("booking_risk") == ["Locatelli"], f"{name}: the diffidati moved"


def test_the_note_travels_with_the_name():
    """The description is the only place the source says «three months» - it must not be dropped."""
    injured = [r for r in fc_site.parse_unavailable(_NEW_SHAPE) if r["status"] == "injured"]
    assert injured[0]["note"] == "al ginocchio"
    assert injured[0]["team"] == "Juventus"
