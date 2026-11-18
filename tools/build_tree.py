#!/usr/bin/env python3
"""
build_tree.py — generate tree.html as a REAL botanical tree drawing,
restyled as STYLE C: the dark glowing tree.

JP picked Style C from three samples (2026-11-17): a premium dark
illustration — deep navy (near-black blue) background, a luminous tree whose
leaves glow cyan/teal/blue, bark picked out in cyan rim light, and a bright
golden thread winding through the branches, with a few soft sparkles.

Reads the canonical page data from tools/tree_data.json (extracted from the
previous tree.html: 7 days -> 15 scenes -> 72 feature leaves with glosses and
family colours, the 14 inter-scene artefact flows, and the 3 long links) and
emits a fully static page whose centrepiece is one large inline SVG: the tree
(tapered trunk with cyan rim light, root flares over a glow pool, 7 day limbs,
15 scene sprays, 72 glowing leaf-shaped leaves in neon family colours) drawn
on a dark poster panel inside the otherwise light page, with a dotted golden
thread winding from the root through the scenes in story order. The family
legend sits directly under the panel on a matching dark strip.

No runtime JS draws the tree. The only scripts on the page are the site's
shared script and the GoatCounter tag, carried over verbatim.

Usage:  python3 tools/build_tree.py
"""
import colorsys, json, math, random, re, sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "tools" / "tree_data.json").read_text(encoding="utf-8"))
PAGE = ROOT / "tree.html"

# ----------------------------------------------------------------------------
# STYLE C THEME — every colour of the dark glowing tree lives here
# ----------------------------------------------------------------------------
THEME = {
    # the poster panel: deep navy, centre lighter, edges near-black blue
    "panel_centre": "#182842",
    "panel_mid":    "#0a1327",
    "panel_edge":   "#03060d",
    "panel_stroke": "#274b78",
    # soft glows
    "canopy_glow":  "#7dd3fc",   # pale cyan halo behind the canopy
    "pool":         "#38bdf8",   # glow pool at the base
    # ground + roots
    "ground_outer": "#0a1526",
    "ground_inner": "#0d1c36",
    "root_base":    "#16233c",
    # bark: very dark blue-brown, cyan rim light
    "bark_top":     "#1e2d49",
    "bark_mid":     "#121b2e",
    "bark_base":    "#090e1a",
    "bark_texture": "#000000",
    "rim":          "#8fe3ff",
    # branches
    "limb":         "#0e1930",
    "twig":         "#16283f",
    "spine":        "#1b2f4a",
    "branchlet":    "#26466a",
    # the golden thread — the brightest element
    "gold":         "#ffd968",
    "gold_deep":    "#8a6d1a",
    "gold_label":   "#f2d67c",
    "gold_long":    "#e8cc74",
    # text on dark (crisp — glow lives on shapes, never on type)
    "halo":         "#030711",
    "day_name":     "#f0d488",   # pale gold
    "day_sub":      "#93c7e8",   # pale cyan
    "scene":        "#b3a6ff",   # pale violet
    "root_ink":     "#fdf6dd",
    "plaque_fill":  "#0a142c",
    "plaque_edge":  "#e9c860",
    # sparkles
    "sparkle_a":    "#cfeaff",
    "sparkle_b":    "#ffe9a8",
    "sparkle_star": "#eaf7ff",
}
# leaves: family hues lifted toward neon
LEAF_LIGHTNESS = 0.62     # HSL lightness of a glowing leaf
LEAF_SAT_BOOST = 1.18
NAME_LIGHTNESS = 0.88     # feature names: pale tint of the family colour
GLOSS_LIGHTNESS = 0.74    # glosses: a step dimmer, same family
SPARKLE_COUNT = 54
SPARKLE_SEED = 20261117

# ----------------------------------------------------------------------------
# text measurement (deterministic estimate, only used for layout sizing)
# ----------------------------------------------------------------------------
NARROW = set("iljtf.,:;'|! ")
WIDE = set("MWmw")

def est_w(text, size, bold=False):
    w = 0.0
    for ch in text:
        if ch in NARROW:
            f = 0.30
        elif ch in WIDE:
            f = 0.80
        elif ch.isupper():
            f = 0.64
        elif ch.isdigit():
            f = 0.56
        elif ch in "⌘⇧·—-":
            f = 0.72
        else:
            f = 0.52
        w += f * size
    if bold:
        w *= 1.05
    return w * 1.07  # safety margin

def shade(hexcolor, f):
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, min(255, round(c * f))) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"

def _hls(hexcolor):
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)

def _hex(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h, max(0.0, min(1.0, l)), max(0.0, min(1.0, s)))
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"

def neon(hexcolor):
    """Family colour lifted toward neon: fixed glow lightness, boosted sat."""
    h, _l, s = _hls(hexcolor)
    return _hex(h, LEAF_LIGHTNESS, min(1.0, s * LEAF_SAT_BOOST + 0.06))

def pale(hexcolor, lightness, sscale=0.85):
    """Pale tint of a family colour, for crisp text on the dark panel."""
    h, _l, s = _hls(hexcolor)
    return _hex(h, lightness, s * sscale)

# ----------------------------------------------------------------------------
# geometry helpers
# ----------------------------------------------------------------------------
def cubic(p0, p1, p2, p3, t):
    mt = 1 - t
    x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
    y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
    return (x, y)

def cubic_tangent(p0, p1, p2, p3, t):
    mt = 1 - t
    x = 3 * mt * mt * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0])
    y = 3 * mt * mt * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1])
    return (x, y)

def catmull_rom_path(pts):
    """Smooth path through pts as cubic segments."""
    if len(pts) < 2:
        return ""
    ext = [pts[0]] + list(pts) + [pts[-1]]
    d = [f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C {c1[0]:.1f} {c1[1]:.1f}, {c2[0]:.1f} {c2[1]:.1f}, {p2[0]:.1f} {p2[1]:.1f}")
    return " ".join(d)

def quad_point(p0, p1, p2, t):
    mt = 1 - t
    return (mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
            mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1])

# ----------------------------------------------------------------------------
# layout constants (unchanged from the light build — same drawing, new theme)
# ----------------------------------------------------------------------------
NAME_FS, GLOSS_FS = 15.5, 11.5
ROW_H = 47            # vertical pitch of one leaf row in a spray
HEADER_H = 46         # scene label zone at the top of a cluster
GLYPH_OFF = 46        # horizontal distance spine -> text start
CLUSTER_GAP = 58      # vertical gap between scene clusters in a band
BAND_GAP = 64         # horizontal gap between day bands in a row
ROW_GAP = 170         # vertical gap between band rows
ROW_MAX_W = 2520      # greedy row packing limit
MARGIN_X = 90
TOP_Y = 104

LEAF_ROT = [-16, 10, -6, 16, -12, 6, -20, 13, -9, 18, -4, 8]

# ----------------------------------------------------------------------------
# step 1: size every scene cluster (a "spray": central spine, leaves alternate
# left/right, labels outward)
# ----------------------------------------------------------------------------
scene_no = 0
for day in DATA["days"]:
    for sc in day["scenes"]:
        scene_no += 1
        sc["no"] = scene_no
        first_right = (scene_no % 2 == 1)
        sides = {"L": [], "R": []}
        for i, leaf in enumerate(sc["leaves"]):
            side = "R" if (i % 2 == 0) == first_right else "L"
            sides[side].append(leaf)
        sc["sides"] = sides
        for side in ("L", "R"):
            lv = sides[side]
            if lv:
                tw = max(max(est_w(l["label"], NAME_FS, True), est_w(l["gloss"], GLOSS_FS)) for l in lv)
                sc[f"w_{side}"] = GLYPH_OFF + tw + 12
            else:
                sc[f"w_{side}"] = 14
        sc["w"] = sc["w_L"] + sc["w_R"]
        sc["rows"] = max(len(sides["L"]), len(sides["R"]))
        sc["h"] = HEADER_H + sc["rows"] * ROW_H + 8

# ----------------------------------------------------------------------------
# step 2: day bands -> rows of bands
# ----------------------------------------------------------------------------
for day in DATA["days"]:
    day["w"] = max(sc["w"] for sc in day["scenes"])
    day["h"] = sum(sc["h"] for sc in day["scenes"]) + CLUSTER_GAP * (len(day["scenes"]) - 1)

rows, cur, cur_w = [], [], 0
for day in DATA["days"]:
    add = day["w"] if not cur else day["w"] + BAND_GAP
    if cur and cur_w + add > ROW_MAX_W:
        rows.append(cur)
        cur, cur_w = [], 0
        add = day["w"]
    cur.append(day)
    cur_w += add
rows.append(cur)
row_ws = [sum(d["w"] for d in r) + BAND_GAP * (len(r) - 1) for r in rows]
row_hs = [max(d["h"] for d in r) for r in rows]
canopy_w = max(row_ws)
canopy_h = sum(row_hs) + ROW_GAP * (len(rows) - 1)

y = TOP_Y
for r, rw, rh in zip(rows, row_ws, row_hs):
    x = MARGIN_X + (canopy_w - rw) / 2
    for day in r:
        day["x"], day["y"] = x, y + (rh - day["h"]) / 2  # stack centred in its row
        x += day["w"] + BAND_GAP
    y += rh + ROW_GAP
canopy_bottom = y - ROW_GAP
canopy_cx = MARGIN_X + canopy_w / 2

# place clusters inside bands (centred horizontally, stacked vertically)
for day in DATA["days"]:
    cy = day["y"]
    for sc in day["scenes"]:
        sc["x"] = day["x"] + (day["w"] - sc["w"]) / 2
        sc["y"] = cy
        sc["spine_x"] = sc["x"] + sc["w_L"]
        sc["stem"] = (sc["spine_x"], cy + sc["h"])
        cy += sc["h"] + CLUSTER_GAP
    day["anchor"] = (day["x"] + day["w"] / 2, day["y"] + day["h"] + 4)

# ----------------------------------------------------------------------------
# step 3: trunk, crown, ground
# ----------------------------------------------------------------------------
crown = (canopy_cx - 12, canopy_bottom + 205)
ground_y = crown[1] + 478
base_cx = canopy_cx + 30
W = canopy_w + 2 * MARGIN_X
H = ground_y + 172

# ----------------------------------------------------------------------------
# step 4: limbs (one per day) and twigs (limb -> each scene stem)
# ----------------------------------------------------------------------------
limbs = []
for i, day in enumerate(DATA["days"]):
    attach = (crown[0] + (i - 3) * 7, crown[1] + 24 + (i % 2) * 24)
    anchor = day["anchor"]
    p1 = (attach[0], attach[1] - 175)
    p2 = (anchor[0] + (attach[0] - anchor[0]) * 0.15, anchor[1] + 175)
    limbs.append({"day": day, "pts": (attach, p1, p2, anchor)})
    day["limb"] = (attach, p1, p2, anchor)

def limb_samples(limb, n=80):
    p0, p1, p2, p3 = limb
    return [cubic(p0, p1, p2, p3, t / n) for t in range(n + 1)]

twigs = []  # (from_point, stem)
for day in DATA["days"]:
    samples = limb_samples(day["limb"])
    for sc in day["scenes"]:
        sx, sy = sc["stem"]
        best = min(samples, key=lambda p: (p[0] - sx) ** 2 + (p[1] - sy) ** 2)
        twigs.append((best, sc["stem"]))

# day-label geometry, computed now so the small-label placement search in
# step 5 can keep artefact/long-link labels clear of the day names: each
# label sits on its limb just below its day's band, rotated along the limb
# but never steeper than +-58 degrees
for limb in limbs:
    p0, p1, p2, p3 = limb["pts"]
    day = limb["day"]
    tx_pt = (day["anchor"][0], day["anchor"][1] + 54)
    best_t, best_d = 0.9, 1e18
    for i in range(161):
        t = i / 160
        q = cubic(p0, p1, p2, p3, t)
        d = (q[0] - tx_pt[0]) ** 2 + (q[1] - tx_pt[1]) ** 2
        if d < best_d:
            best_d, best_t = d, t
    pt = cubic(p0, p1, p2, p3, best_t)
    tx, ty = cubic_tangent(p0, p1, p2, p3, best_t)
    ang = math.degrees(math.atan2(ty, tx))
    while ang < -90:
        ang += 180
    while ang > 90:
        ang -= 180
    limb["label_pt"] = pt
    limb["label_ang"] = max(-58, min(58, ang))

# ----------------------------------------------------------------------------
# step 5: emit SVG (Style C — dark glowing tree on a navy poster panel)
# ----------------------------------------------------------------------------
T = THEME
out = []
def E(s):
    out.append(s)

E(f'<svg id="botanical-tree" viewBox="0 0 {W:.0f} {H:.0f}" role="img" '
  f'aria-label="A drawing of a glowing tree on a dark navy panel: its branches are the seven days of one fictional week and its 72 luminous leaves are every LocalNote feature, joined by one golden thread." '
  f'xmlns="http://www.w3.org/2000/svg">')
E('<title>LocalNote — one week, one record: the whole product as one tree</title>')
E('<desc>Trunk and roots: LocalNote. Limbs: Sunday night to Friday evening. '
  'Branches: the week\u2019s fifteen scenes. Leaves: the 72 features, glowing in their family colours. '
  'A dotted golden thread winds from the root through the scenes in story order.</desc>')
E('<defs>'
  f'<radialGradient id="panelGrad" cx="50%" cy="30%" r="80%">'
  f'<stop offset="0%" stop-color="{T["panel_centre"]}"/>'
  f'<stop offset="55%" stop-color="{T["panel_mid"]}"/>'
  f'<stop offset="100%" stop-color="{T["panel_edge"]}"/>'
  '</radialGradient>'
  f'<radialGradient id="canopyGlowGrad" cx="50%" cy="50%" r="50%">'
  f'<stop offset="0%" stop-color="{T["canopy_glow"]}" stop-opacity=".13"/>'
  f'<stop offset="60%" stop-color="{T["canopy_glow"]}" stop-opacity=".05"/>'
  f'<stop offset="100%" stop-color="{T["canopy_glow"]}" stop-opacity="0"/>'
  '</radialGradient>'
  f'<radialGradient id="poolGrad" cx="50%" cy="50%" r="50%">'
  f'<stop offset="0%" stop-color="{T["pool"]}" stop-opacity=".30"/>'
  f'<stop offset="100%" stop-color="{T["pool"]}" stop-opacity="0"/>'
  '</radialGradient>'
  f'<linearGradient id="barkGrad" x1="0" y1="0" x2="0" y2="1">'
  f'<stop offset="0%" stop-color="{T["bark_top"]}"/>'
  f'<stop offset="55%" stop-color="{T["bark_mid"]}"/>'
  f'<stop offset="100%" stop-color="{T["bark_base"]}"/>'
  '</linearGradient>'
  # one shared glow filter for every leaf shape (blur of the shape itself,
  # merged back under the crisp original) — never applied to text
  '<filter id="leafGlow" x="-90%" y="-90%" width="280%" height="280%">'
  '<feGaussianBlur stdDeviation="3.2" result="b"/>'
  '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
  '</filter>'
  # a wider, softer glow for the golden thread and the root plaque
  '<filter id="goldGlow" x="-40%" y="-40%" width="180%" height="180%">'
  '<feGaussianBlur stdDeviation="5" result="b"/>'
  '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
  '</filter>'
  '</defs>')
E('<style>'
  ".lf-name{font-family:'DM Sans',system-ui,sans-serif;font-size:15.5px;font-weight:700}"
  ".lf-gloss{font-family:'DM Sans',system-ui,sans-serif;font-size:11.5px}"
  f".sc-label{{font-family:Manrope,system-ui,sans-serif;font-size:14.5px;font-weight:800;letter-spacing:1.6px;fill:{T['scene']}}}"
  f".day-name{{font-family:Manrope,system-ui,sans-serif;font-size:23px;font-weight:800;letter-spacing:2.5px;fill:{T['day_name']}}}"
  f".day-sub{{font-family:Manrope,system-ui,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.4px;fill:{T['day_sub']}}}"
  f".art-label{{font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:700;fill:{T['gold_label']}}}"
  f".long-label{{font-family:'DM Sans',system-ui,sans-serif;font-size:12px;font-weight:700;fill:{T['gold_long']};opacity:.9}}"
  f".root-label{{font-family:Manrope,system-ui,sans-serif;font-size:25px;font-weight:800;fill:{T['root_ink']}}}"
  f".halo{{paint-order:stroke;stroke:{T['halo']};stroke-width:4.5px;stroke-linejoin:round}}"
  '</style>')

# the dark poster panel itself (rounded, inside the SVG so the poster is
# self-contained), with a faint inner edge
E(f'<rect x="8" y="8" width="{W - 16:.0f}" height="{H - 16:.0f}" rx="44" fill="url(#panelGrad)"/>')
E(f'<rect x="8" y="8" width="{W - 16:.0f}" height="{H - 16:.0f}" rx="44" fill="none" '
  f'stroke="{T["panel_stroke"]}" stroke-width="2" opacity=".55"/>')
E('<!--SPARKLES-->')  # filled in at the end, once every label is placed

# canopy backdrop — a soft cyan halo behind the foliage
E(f'<ellipse cx="{canopy_cx:.0f}" cy="{TOP_Y + canopy_h / 2:.0f}" rx="{canopy_w / 2 + 56:.0f}" '
  f'ry="{canopy_h / 2 + 64:.0f}" fill="url(#canopyGlowGrad)"/>')

# ground + glow pool + roots (behind trunk)
E(f'<ellipse cx="{base_cx:.0f}" cy="{ground_y + 20:.0f}" rx="660" ry="42" fill="{T["ground_outer"]}"/>')
E(f'<ellipse cx="{base_cx:.0f}" cy="{ground_y + 14:.0f}" rx="470" ry="30" fill="{T["ground_inner"]}"/>')
E(f'<ellipse cx="{base_cx:.0f}" cy="{ground_y + 16:.0f}" rx="560" ry="46" fill="url(#poolGrad)"/>')
for dx in (-335, -208, -96, 112, 228, 348):
    rp = (f'M {base_cx + dx * 0.10:.1f} {ground_y - 42:.1f} Q {base_cx + dx * 0.55:.1f} {ground_y - 14:.1f} '
          f'{base_cx + dx:.1f} {ground_y + 5:.1f}')
    E(f'<path d="{rp}" fill="none" stroke="{T["root_base"]}" stroke-width="12" stroke-linecap="round"/>')
    E(f'<path d="{rp}" fill="none" stroke="{T["rim"]}" stroke-width="2.2" stroke-linecap="round" '
      f'opacity=".45" transform="translate(0 -3.5)"/>')

# label placement helper: keep small labels out of the foliage clusters
CLUSTER_RECTS = []
for _d in DATA["days"]:
    for _sc in _d["scenes"]:
        CLUSTER_RECTS.append((_sc["x"] - 16, _sc["y"] - 16, _sc["x"] + _sc["w"] + 16, _sc["y"] + _sc["h"] + 16))
PLAQUE_RECT = (base_cx - 290, ground_y + 24, base_cx + 290, ground_y + 110)

PLACED_LABELS = []

# reserve the day labels' (rotated) boxes so the search below keeps the
# small gold labels clear of the big gold day names
for _limb in limbs:
    _pt, _ang = _limb["label_pt"], math.radians(_limb["label_ang"])
    _w = est_w(_limb["day"]["name"].upper(), 23, True)
    _hw = _w / 2 * abs(math.cos(_ang)) + 13 * abs(math.sin(_ang))
    _hh = _w / 2 * abs(math.sin(_ang)) + 13 * abs(math.cos(_ang))
    PLACED_LABELS.append((_pt[0] - _hw, _pt[1] - _hh, _pt[0] + _hw, _pt[1] + _hh))
    _sw = est_w(_limb["day"]["sub"], 12, True) / 2
    PLACED_LABELS.append((_pt[0] - _sw, _pt[1] + 24, _pt[0] + _sw, _pt[1] + 48))

# artefact + long-link label markup is collected here and emitted only after
# the leaf clusters, so a label that lands inside the foliage still sits on
# top of it — crisp gold on a dark halo, never buried under a glowing leaf
LABELS = []
def EL(s):
    LABELS.append(s)

def _hits(x, y, hw, hh=14):
    for (x0, y0, x1, y1) in CLUSTER_RECTS + [PLAQUE_RECT] + PLACED_LABELS:
        if x - hw < x1 and x + hw > x0 and y - hh < y1 and y + hh > y0:
            return True
    return False

def place_label(cands, text, size):
    """cands: ordered (x, y) candidates; returns first whose text box is clear
    of every cluster, the root plaque, and every label placed before it."""
    hw = est_w(text, size, True) / 2
    for (x, y) in cands:
        if not _hits(x, y, hw):
            PLACED_LABELS.append((x - hw, y - 14, x + hw, y + 14))
            return (x, y)
    x, y = cands[0]
    PLACED_LABELS.append((x - hw, y - 14, x + hw, y + 14))
    return (x, y)

# long-link arcs (behind everything else in the canopy)
scene_by_id = {sc["id"]: sc for d in DATA["days"] for sc in d["scenes"]}
for ll in DATA["longlinks"]:
    a, b = scene_by_id[ll["from"]]["stem"], scene_by_id[ll["to"]]["stem"]
    ctrl = ((a[0] + b[0]) / 2 + 300, (a[1] + b[1]) / 2 - 60)
    E(f'<path d="M {a[0]:.1f} {a[1]:.1f} Q {ctrl[0]:.1f} {ctrl[1]:.1f} {b[0]:.1f} {b[1]:.1f}" fill="none" '
      f'stroke="{T["gold_long"]}" stroke-width="1.7" stroke-dasharray="6 5" opacity=".5"/>')
    for p in (a, b):
        E(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="3.5" fill="{T["gold"]}" opacity=".85"/>')
    apex = quad_point(a, ctrl, b, 0.5)
    tgt = scene_by_id[ll["to"]]
    short = (tgt.get("inbound") or "").replace("⟵ from ", "")
    short = short.split(": ", 1)[-1]
    short = short[:1].upper() + short[1:]
    cands = [(apex[0] + dx, apex[1] + dy) for (dx, dy) in
             ((12, -12), (34, -22), (-34, -22), (12, -38), (58, -4), (-58, -4), (12, 22))]
    lx, ly = place_label(cands, short, 12)
    EL(f'<text class="long-label halo" x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle">{escape(short)}</text>')

# limbs: dark blue-brown bodies, cyan rim light on the lit edge
for limb in limbs:
    p0, p1, p2, p3 = limb["pts"]
    d = f'M {p0[0]:.1f} {p0[1]:.1f} C {p1[0]:.1f} {p1[1]:.1f}, {p2[0]:.1f} {p2[1]:.1f}, {p3[0]:.1f} {p3[1]:.1f}'
    E(f'<path d="{d}" fill="none" stroke="{T["limb"]}" stroke-width="11" stroke-linecap="round"/>')
    E(f'<path d="{d}" fill="none" stroke="{T["rim"]}" stroke-width="3.2" stroke-linecap="round" opacity=".42" transform="translate(-2.5 -2.5)"/>')

# twigs + spines
for frm, stem in twigs:
    mid = ((frm[0] + stem[0]) / 2, (frm[1] + stem[1]) / 2 - 14)
    E(f'<path d="M {frm[0]:.1f} {frm[1]:.1f} Q {mid[0]:.1f} {mid[1]:.1f} {stem[0]:.1f} {stem[1]:.1f}" '
      f'fill="none" stroke="{T["twig"]}" stroke-width="5" stroke-linecap="round"/>')
for day in DATA["days"]:
    for sc in day["scenes"]:
        top = sc["y"] + HEADER_H - 2
        E(f'<path d="M {sc["spine_x"]:.1f} {sc["stem"][1]:.1f} C {sc["spine_x"] - 5:.1f} {sc["stem"][1] - 60:.1f}, '
          f'{sc["spine_x"] + 5:.1f} {top + 60:.1f}, {sc["spine_x"]:.1f} {top:.1f}" fill="none" stroke="{T["spine"]}" stroke-width="4.5" stroke-linecap="round"/>')

# trunk (over limb bases)
tcx0, tcy0 = crown
tcx1, tcy1 = base_cx, ground_y
E(f'<path d="M {tcx1 - 92:.1f} {tcy1:.1f} C {tcx1 - 70:.1f} {tcy1 - 130:.1f}, {tcx0 - 27:.1f} {tcy0 + 150:.1f}, {tcx0 - 15:.1f} {tcy0:.1f} '
  f'Q {tcx0:.1f} {tcy0 - 12:.1f} {tcx0 + 15:.1f} {tcy0:.1f} '
  f'C {tcx0 + 27:.1f} {tcy0 + 150:.1f}, {tcx1 + 70:.1f} {tcy1 - 130:.1f}, {tcx1 + 92:.1f} {tcy1:.1f} '
  f'Q {tcx1:.1f} {tcy1 + 15:.1f} {tcx1 - 92:.1f} {tcy1:.1f} Z" fill="url(#barkGrad)"/>')
# bark texture: curves following the trunk centreline, offset by taper
for off, wdt, op in ((-17, 3, .30), (-6, 2.4, .34), (8, 2.4, .30), (18, 3, .26)):
    pts = []
    for i in range(25):
        t = i / 24
        cx = (1 - t) * tcx0 + t * tcx1 + 6 * t * (1 - t)
        cy = (1 - t) * tcy0 + t * tcy1
        hw = 15 + (56 - 15) * t
        pts.append((cx + off * hw / 56, cy))
    E(f'<path d="{catmull_rom_path(pts)}" fill="none" stroke="{T["bark_texture"]}" stroke-width="{wdt}" opacity="{op}" stroke-linecap="round"/>')
# a faint inner light line down the trunk
E(f'<path d="{catmull_rom_path([(tcx0 - 7 + 3 * t, tcy0 + (tcy1 - tcy0) * t / 24) for t in range(25)])}" '
  f'fill="none" stroke="{T["rim"]}" stroke-width="2.2" opacity=".35" stroke-linecap="round"/>')
# cyan rim light on the trunk's lit (left) edge, glowing; a whisper on the right
E(f'<path d="M {tcx1 - 92:.1f} {tcy1:.1f} C {tcx1 - 70:.1f} {tcy1 - 130:.1f}, {tcx0 - 27:.1f} {tcy0 + 150:.1f}, {tcx0 - 15:.1f} {tcy0:.1f}" '
  f'fill="none" stroke="{T["rim"]}" stroke-width="3" opacity=".85" stroke-linecap="round" filter="url(#leafGlow)"/>')
E(f'<path d="M {tcx1 + 92:.1f} {tcy1:.1f} C {tcx1 + 70:.1f} {tcy1 - 130:.1f}, {tcx0 + 27:.1f} {tcy0 + 150:.1f}, {tcx0 + 15:.1f} {tcy0:.1f}" '
  f'fill="none" stroke="{T["rim"]}" stroke-width="2" opacity=".28" stroke-linecap="round"/>')

# golden thread: root -> crown -> scene stems in story order (brightest
# element on the panel; one glow filter over path + rings, never over text)
stems = [sc["stem"] for d in DATA["days"] for sc in d["scenes"]]
thread_pts = [(base_cx, ground_y - 96), (crown[0], crown[1] + 6)] + stems
E('<g filter="url(#goldGlow)">')
E(f'<path d="{catmull_rom_path(thread_pts)}" fill="none" stroke="{T["gold"]}" stroke-width="3.4" '
  f'stroke-dasharray="0.1 9" stroke-linecap="round"/>')
E(f'<circle cx="{base_cx:.1f}" cy="{ground_y - 96:.1f}" r="7" fill="{T["gold"]}" stroke="{T["gold_deep"]}" stroke-width="1.6"/>')
for p in stems:
    E(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="6" fill="{T["gold"]}" stroke="{T["gold_deep"]}" stroke-width="1.6"/>')
E('</g>')
# artefact labels between consecutive scene stops (nudged clear of clusters)
for k, flow in enumerate(DATA["flows"]):
    a, b = stems[k], stems[k + 1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1
    px, py = -dy / ln, dx / ln
    pref = 1 if k % 2 == 0 else -1
    cands = []
    # late candidates sit just past the source stop — in the gap under the
    # source cluster — for flows whose segment crosses the next cluster and
    # whose mid-segment candidates are all boxed in
    for t in (0.5, 0.36, 0.64, 0.24, 0.76, 0.88, 0.08, 0.16, 0.93):
        mx, my = a[0] + dx * t, a[1] + dy * t
        for sgn in (pref, -pref):
            for dist in (30, 46, 64, 84, 110, 140):
                cands.append((mx + px * dist * sgn, my + py * dist * sgn))
        for voff in (-34, 34, -56, 56, -84, 84):
            cands.append((mx, my + voff))
    lx, ly = place_label(cands, flow["label"], 13)
    EL(f'<text class="art-label halo" x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle">{escape(flow["label"])}</text>')

# day labels: geometry precomputed in step 4 (and already reserved above)
for limb in limbs:
    day = limb["day"]
    pt, ang = limb["label_pt"], limb["label_ang"]
    E(f'<text class="day-name halo" x="{pt[0]:.1f}" y="{pt[1]:.1f}" text-anchor="middle" '
      f'transform="rotate({ang:.1f} {pt[0]:.1f} {pt[1]:.1f})">{escape(day["name"].upper())}</text>')
    E(f'<text class="day-sub halo" x="{pt[0]:.1f}" y="{pt[1] + 36:.1f}" text-anchor="middle">{escape(day["sub"])}</text>')

# scene clusters: labels, branchlets, glowing leaves
leaf_no = 0
for day in DATA["days"]:
    for sc in day["scenes"]:
        cx = sc["x"] + sc["w"] / 2
        E(f'<text class="sc-label halo" x="{cx:.1f}" y="{sc["y"] + 27:.1f}" text-anchor="middle">{escape(sc["ssub"])}</text>')
        for side in ("L", "R"):
            for i, leaf in enumerate(sc["sides"][side]):
                leaf_no += 1
                ry = sc["y"] + HEADER_H + i * ROW_H + 22
                spine = sc["spine_x"]
                if side == "R":
                    bx = spine + 8
                    text_x, anchor = spine + GLYPH_OFF, "start"
                    flip = 1
                else:
                    bx = spine - 8
                    text_x, anchor = spine - GLYPH_OFF, "end"
                    flip = -1
                # branchlet from spine to leaf base
                E(f'<path d="M {spine:.1f} {ry - 4:.1f} Q {(spine + bx) / 2:.1f} {ry - 9:.1f} {bx:.1f} {ry - 5:.1f}" '
                  f'fill="none" stroke="{T["branchlet"]}" stroke-width="2.6" stroke-linecap="round"/>')
                rot = LEAF_ROT[(leaf_no - 1) % len(LEAF_ROT)] * flip
                glow = neon(leaf["color"])
                edge = pale(leaf["color"], 0.80)
                ink = pale(leaf["color"], NAME_LIGHTNESS)
                ink2 = pale(leaf["color"], GLOSS_LIGHTNESS)
                E(f'<g class="leaf" data-name="{escape(leaf["name"], quote=True)}" data-family="{escape(leaf["family"], quote=True)}">'
                  f'<title>{escape(leaf["label"])} — {escape(leaf["gloss"])}</title>'
                  f'<g transform="translate({bx:.1f} {ry - 5:.1f}) scale({flip} 1) rotate({rot})" filter="url(#leafGlow)">'
                  f'<path d="M0,0 C8,-8.5 19,-10 30,0 C19,10 8,8.5 0,0 Z" fill="{glow}" stroke="{edge}" stroke-width="1.1"/>'
                  f'<path d="M2.5,0 L26,0" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.4" fill="none"/>'
                  f'</g>'
                  f'<text class="lf-name" x="{text_x:.1f}" y="{ry:.1f}" text-anchor="{anchor}" fill="{ink}">{escape(leaf["label"])}</text>'
                  f'<text class="lf-gloss" x="{text_x:.1f}" y="{ry + 17:.1f}" text-anchor="{anchor}" fill="{ink2}" opacity=".95">{escape(leaf["gloss"])}</text>'
                  f'</g>')

# the small gold labels, on top of the foliage at last
out.extend(LABELS)

# root plaque — dark, gold-edged, softly glowing
root_text = "LocalNote — one week, one record"
pw = est_w(root_text, 25, True) + 58
E(f'<rect x="{base_cx - pw / 2:.1f}" y="{ground_y + 36:.1f}" width="{pw:.1f}" height="62" rx="18" '
  f'fill="{T["plaque_fill"]}" stroke="{T["plaque_edge"]}" stroke-width="2" filter="url(#goldGlow)"/>')
E(f'<circle cx="{base_cx - pw / 2 + 24:.1f}" cy="{ground_y + 67:.1f}" r="4.5" fill="{T["gold"]}"/>')
E(f'<circle cx="{base_cx + pw / 2 - 24:.1f}" cy="{ground_y + 67:.1f}" r="4.5" fill="{T["gold"]}"/>')
E(f'<text class="root-label" x="{base_cx:.1f}" y="{ground_y + 76:.1f}" text-anchor="middle">{escape(root_text)}</text>')

# sparkles: a sparse scatter in the panel's empty spaces (seeded, so the
# page is deterministic). Positions are chosen now — after every label is
# placed — but the markup is spliced in just behind the panel, so the dots
# sit under the tree. Avoid clusters, the plaque, day labels, the trunk
# corridor, and each other.
DAY_RECTS = [(d["anchor"][0] - 185, d["anchor"][1] + 8, d["anchor"][0] + 185, d["anchor"][1] + 112)
             for d in DATA["days"]]
_avoid = CLUSTER_RECTS + [PLAQUE_RECT] + DAY_RECTS + PLACED_LABELS
rng = random.Random(SPARKLE_SEED)
sparkles, tries = [], 0
while len(sparkles) < SPARKLE_COUNT and tries < 6000:
    tries += 1
    x = rng.uniform(40, W - 40)
    y = rng.uniform(40, H - 100)
    if any(x > a - 6 and x < b + 6 and y > c - 6 and y < d + 6 for (a, c, b, d) in _avoid):
        continue
    if crown[1] - 30 < y < ground_y + 30:  # trunk corridor
        tcx = tcx0 + (tcx1 - tcx0) * ((y - tcy0) / max(1.0, tcy1 - tcy0))
        if abs(x - tcx) < 135:
            continue
    if any((x - sx) ** 2 + (y - sy) ** 2 < 30 ** 2 for (sx, sy) in sparkles):
        continue
    sparkles.append((x, y))
sp = []
for i, (x, y) in enumerate(sparkles):
    if i % 5 == 4:  # every fifth is a four-point star
        s = rng.uniform(0.7, 1.25)
        op = rng.uniform(0.5, 0.85)
        filt = ' filter="url(#leafGlow)"' if i % 15 == 4 else ''
        sp.append(f'<path d="M0,-8 C1,-2 2,-1 8,0 C2,1 1,2 0,8 C-1,2 -2,1 -8,0 C-2,-1 -1,-2 0,-8 Z" '
                  f'transform="translate({x:.1f} {y:.1f}) scale({s:.2f})" fill="{T["sparkle_star"]}" opacity="{op:.2f}"{filt}/>')
    else:
        r = rng.uniform(1.1, 2.5)
        col = T["sparkle_b"] if i % 4 == 3 else T["sparkle_a"]
        op = rng.uniform(0.3, 0.75)
        sp.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{col}" opacity="{op:.2f}"/>')
sparkle_svg = "".join(sp)
E('</svg>')
svg = "\n".join(out).replace('<!--SPARKLES-->', sparkle_svg)

# ----------------------------------------------------------------------------
# step 6: assemble the page. The generator owns the head <style> block, the
# legend (restyled as a dark strip directly under the panel) and the figure;
# the rest of the chrome (intro, status note, CTA, footer, scripts) is
# carried over verbatim.
# ----------------------------------------------------------------------------
src = PAGE.read_text(encoding="utf-8")
FIG_A, FIG_B = "<!-- TREE-FIGURE-START -->", "<!-- TREE-FIGURE-END -->"
if FIG_A not in src:
    sys.exit("tree.html: TREE-FIGURE markers not found — refusing to regenerate")
prefix = src[:src.index(FIG_A)]
suffix = src[src.index(FIG_B) + len(FIG_B):]

# the site's shared mobile rules, carried verbatim into the new style block
_ms = prefix.index('@media(max-width:720px)')
_d = 0
for _i in range(_ms, len(prefix)):
    if prefix[_i] == '{':
        _d += 1
    elif prefix[_i] == '}':
        _d -= 1
        if _d == 0:
            break
shared_media = prefix[_ms:_i + 1]

# legend chips: (base family colour, label) pairs. On the first run they sit
# in the light legend in the prefix; on later runs they sit in the dark strip
# inside the figure block and carry their base colour in data-base, so the
# extraction works — identically — either way.
chips = []
for m in re.finditer(r'<span class="lg"><i class="dotp"([^>]*)></i>([^<]+)</span>', src):
    attrs, label = m.group(1), m.group(2)
    base = re.search(r'data-base="(#[0-9a-f]{6})"', attrs) or re.search(r'--fc:(#[0-9a-f]{6})', attrs)
    if base:
        chips.append((base.group(1), label))
if len(chips) != 14:
    sys.exit(f"tree.html: expected 14 legend chips, found {len(chips)}")
# drop the old light legend section from the prefix, if it is still there
# (it moves under the panel; on later runs it is already gone)
prefix, _n = re.subn(r'<section class="container section narrow" style="padding-top:6px">.*?</section>\s*', '', prefix, count=1, flags=re.S)
if _n == 0 and 'class="legend"' in prefix:
    sys.exit("tree.html: legend markup in prefix is in an unexpected place")

new_style = ("<style>" + shared_media + "\n"
    ".legend{display:flex;flex-wrap:wrap;gap:7px}\n"
    ".legend .lg{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-weight:700;border-radius:99px;padding:5px 10px}\n"
    ".legend .dotp{width:9px;height:9px;border-radius:50%;background:var(--fc);flex:none;display:inline-block}\n"
    ".legendstrip{background:linear-gradient(180deg,#0a1327,#04070f);border:1px solid #1e3a5f;border-radius:20px;padding:14px 16px;margin-top:14px}\n"
    ".legend-dark .lg{color:#d9e6ff;border:1px solid rgba(150,185,255,.30);background:rgba(120,170,255,.06)}\n"
    ".legend-dark .dotp{box-shadow:0 0 8px 1px var(--fc)}\n"
    ".tree-wide{width:min(2180px,97.5vw);margin:0 auto;padding-bottom:10px}\n"
    ".tree-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}\n"
    ".treefig{margin:0}\n"
    ".treefig svg{display:block;width:100%;height:auto;min-width:1020px}\n"
    ".tree-cap{max-width:780px;margin:16px auto 0;text-align:center;color:var(--muted);font-size:.93rem;line-height:1.65}\n"
    "</style>")
prefix = re.sub(r'<style>.*?</style>', new_style, prefix, count=1, flags=re.S)

legend_html = "".join(
    f'<span class="lg"><i class="dotp" data-base="{c}" style="--fc:{neon(c)};background:{neon(c)}"></i>{label}</span>'
    for (c, label) in chips)
legend_section = ('<section class="tree-wide"><div class="legendstrip">'
    f'<div class="legend legend-dark" aria-label="Feature families">{legend_html}</div>'
    '</div></section>')

caption = ("Sunday night to Friday evening: a spoken intent becomes Monday&rsquo;s plan and brief, "
           "Tuesday&rsquo;s meeting, Wednesday&rsquo;s chase, Thursday&rsquo;s evidence and Friday&rsquo;s landing. "
           "The golden thread is the week itself, winding from the root through every scene in order. "
           "Follow the lines and you follow the whole product.")
figure = (FIG_A + "\n"
    '<section class="tree-wide"><div class="tree-scroll"><figure class="treefig">\n'
    + svg + "\n"
    f'<figcaption class="tree-cap">{caption}</figcaption></figure></div></section>\n'
    + legend_section + "\n"
    + FIG_B)

PAGE.write_text(prefix + figure + suffix, encoding="utf-8")
print(f"viewBox: {W:.0f} x {H:.0f} | rows: {[len(r) for r in rows]} | "
      f"canopy: {canopy_w:.0f} x {canopy_h:.0f} | leaves emitted: {leaf_no} | sparkles: {len(sparkles)}")
print(f"tree.html written: {PAGE.stat().st_size} bytes")
