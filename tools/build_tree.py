#!/usr/bin/env python3
"""
build_tree.py — generate tree.html as a REAL botanical tree drawing.

Reads the canonical page data from tools/tree_data.json (extracted from the
previous tree.html: 7 days -> 15 scenes -> 72 feature leaves with glosses and
family colours, the 14 inter-scene artefact flows, and the 3 long links) and
emits a fully static page whose centrepiece is one large inline SVG: a drawn
tree (tapered bark trunk, root flares, ground, 7 day limbs, 15 scene sprays,
72 leaf-shaped leaves in family colours) with a dotted golden thread winding
from the root through the scenes in story order.

No runtime JS draws the tree. The only scripts on the page are the site's
shared script and the GoatCounter tag, carried over verbatim.

Usage:  python3 tools/build_tree.py
"""
import json, math, re, sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "tools" / "tree_data.json").read_text(encoding="utf-8"))
PAGE = ROOT / "tree.html"

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
# layout constants
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

# ----------------------------------------------------------------------------
# step 5: emit SVG
# ----------------------------------------------------------------------------
out = []
def E(s):
    out.append(s)

E(f'<svg id="botanical-tree" viewBox="0 0 {W:.0f} {H:.0f}" role="img" '
  f'aria-label="A drawing of a tree whose branches are the seven days of one fictional week and whose 72 leaves are every LocalNote feature, joined by one golden thread." '
  f'xmlns="http://www.w3.org/2000/svg">')
E('<title>LocalNote — one week, one record: the whole product as one tree</title>')
E('<desc>Trunk and roots: LocalNote. Limbs: Sunday night to Friday evening. '
  'Branches: the week\u2019s fifteen scenes. Leaves: the 72 features, coloured by family. '
  'A dotted golden thread winds from the root through the scenes in story order.</desc>')
E('<defs>'
  '<radialGradient id="canopyGrad" cx="50%" cy="42%" r="65%">'
  '<stop offset="0%" stop-color="#e9f1d6" stop-opacity=".85"/>'
  '<stop offset="70%" stop-color="#eef3dc" stop-opacity=".45"/>'
  '<stop offset="100%" stop-color="#eef3dc" stop-opacity="0"/>'
  '</radialGradient>'
  '<linearGradient id="barkGrad" x1="0" y1="0" x2="0" y2="1">'
  '<stop offset="0%" stop-color="#7b5734"/><stop offset="55%" stop-color="#654628"/>'
  '<stop offset="100%" stop-color="#4a3018"/>'
  '</linearGradient></defs>')
E('<style>'
  ".lf-name{font-family:'DM Sans',system-ui,sans-serif;font-size:15.5px;font-weight:700;fill:#26263e}"
  ".lf-gloss{font-family:'DM Sans',system-ui,sans-serif;font-size:11.5px;fill:#666d80}"
  ".sc-label{font-family:Manrope,system-ui,sans-serif;font-size:14.5px;font-weight:800;letter-spacing:1.6px;fill:#5d48d1}"
  ".day-name{font-family:Manrope,system-ui,sans-serif;font-size:23px;font-weight:800;letter-spacing:1px;fill:#43301d}"
  ".day-sub{font-family:Manrope,system-ui,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.4px;fill:#5d48d1}"
  ".art-label{font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:700;fill:#8a6d1a}"
  ".long-label{font-family:'DM Sans',system-ui,sans-serif;font-size:12px;font-weight:700;fill:#8a6d1a;opacity:.85}"
  ".root-label{font-family:Manrope,system-ui,sans-serif;font-size:25px;font-weight:800;fill:#33302a}"
  ".halo{paint-order:stroke;stroke:#ffffff;stroke-width:4px;stroke-linejoin:round}"
  '</style>')

# canopy backdrop
E(f'<ellipse cx="{canopy_cx:.0f}" cy="{TOP_Y + canopy_h / 2:.0f}" rx="{canopy_w / 2 + 56:.0f}" '
  f'ry="{canopy_h / 2 + 64:.0f}" fill="url(#canopyGrad)"/>')

# ground + roots (behind trunk)
E(f'<ellipse cx="{base_cx:.0f}" cy="{ground_y + 20:.0f}" rx="660" ry="42" fill="#e7ead3"/>')
E(f'<ellipse cx="{base_cx:.0f}" cy="{ground_y + 14:.0f}" rx="470" ry="30" fill="#d8dcba"/>')
for dx in (-335, -208, -96, 112, 228, 348):
    E(f'<path d="M {base_cx + dx * 0.10:.1f} {ground_y - 42:.1f} Q {base_cx + dx * 0.55:.1f} {ground_y - 14:.1f} '
      f'{base_cx + dx:.1f} {ground_y + 5:.1f}" fill="none" stroke="#54391f" stroke-width="12" stroke-linecap="round"/>')

# label placement helper: keep small labels out of the foliage clusters
CLUSTER_RECTS = []
for _d in DATA["days"]:
    for _sc in _d["scenes"]:
        CLUSTER_RECTS.append((_sc["x"] - 16, _sc["y"] - 16, _sc["x"] + _sc["w"] + 16, _sc["y"] + _sc["h"] + 16))
PLAQUE_RECT = (base_cx - 290, ground_y + 24, base_cx + 290, ground_y + 110)

PLACED_LABELS = []

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
      f'stroke="#d9b84a" stroke-width="1.7" stroke-dasharray="6 5" opacity=".55"/>')
    for p in (a, b):
        E(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="3.5" fill="#d9b84a" opacity=".8"/>')
    apex = quad_point(a, ctrl, b, 0.5)
    tgt = scene_by_id[ll["to"]]
    short = (tgt.get("inbound") or "").replace("⟵ from ", "")
    short = short.split(": ", 1)[-1]
    short = short[:1].upper() + short[1:]
    cands = [(apex[0] + dx, apex[1] + dy) for (dx, dy) in
             ((12, -12), (34, -22), (-34, -22), (12, -38), (58, -4), (-58, -4), (12, 22))]
    lx, ly = place_label(cands, short, 12)
    E(f'<text class="long-label halo" x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle">{escape(short)}</text>')

# limbs
for limb in limbs:
    p0, p1, p2, p3 = limb["pts"]
    d = f'M {p0[0]:.1f} {p0[1]:.1f} C {p1[0]:.1f} {p1[1]:.1f}, {p2[0]:.1f} {p2[1]:.1f}, {p3[0]:.1f} {p3[1]:.1f}'
    E(f'<path d="{d}" fill="none" stroke="#66452a" stroke-width="11" stroke-linecap="round"/>')
    E(f'<path d="{d}" fill="none" stroke="#7d5a38" stroke-width="4" stroke-linecap="round" opacity=".55" transform="translate(-2.5 -2.5)"/>')

# twigs + spines
for frm, stem in twigs:
    mid = ((frm[0] + stem[0]) / 2, (frm[1] + stem[1]) / 2 - 14)
    E(f'<path d="M {frm[0]:.1f} {frm[1]:.1f} Q {mid[0]:.1f} {mid[1]:.1f} {stem[0]:.1f} {stem[1]:.1f}" '
      f'fill="none" stroke="#77572f" stroke-width="5" stroke-linecap="round"/>')
for day in DATA["days"]:
    for sc in day["scenes"]:
        top = sc["y"] + HEADER_H - 2
        E(f'<path d="M {sc["spine_x"]:.1f} {sc["stem"][1]:.1f} C {sc["spine_x"] - 5:.1f} {sc["stem"][1] - 60:.1f}, '
          f'{sc["spine_x"] + 5:.1f} {top + 60:.1f}, {sc["spine_x"]:.1f} {top:.1f}" fill="none" stroke="#77572f" stroke-width="4.5" stroke-linecap="round"/>')

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
    E(f'<path d="{catmull_rom_path(pts)}" fill="none" stroke="#38250f" stroke-width="{wdt}" opacity="{op}" stroke-linecap="round"/>')
E(f'<path d="{catmull_rom_path([(tcx0 - 7 + 3 * t, tcy0 + (tcy1 - tcy0) * t / 24) for t in range(25)])}" '
  f'fill="none" stroke="#97744a" stroke-width="2.6" opacity=".45" stroke-linecap="round"/>')

# golden thread: root -> crown -> scene stems in story order
stems = [sc["stem"] for d in DATA["days"] for sc in d["scenes"]]
thread_pts = [(base_cx, ground_y - 96), (crown[0], crown[1] + 6)] + stems
E(f'<path d="{catmull_rom_path(thread_pts)}" fill="none" stroke="#d9b84a" stroke-width="3.4" '
  f'stroke-dasharray="0.1 9" stroke-linecap="round"/>')
E(f'<circle cx="{base_cx:.1f}" cy="{ground_y - 96:.1f}" r="7" fill="#d9b84a" stroke="#8a6d1a" stroke-width="1.6"/>')
for p in stems:
    E(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="6" fill="#d9b84a" stroke="#8a6d1a" stroke-width="1.6"/>')
# artefact labels between consecutive scene stops (nudged clear of clusters)
for k, flow in enumerate(DATA["flows"]):
    a, b = stems[k], stems[k + 1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1
    px, py = -dy / ln, dx / ln
    pref = 1 if k % 2 == 0 else -1
    cands = []
    for t in (0.5, 0.36, 0.64, 0.24, 0.76, 0.88):
        mx, my = a[0] + dx * t, a[1] + dy * t
        for sgn in (pref, -pref):
            for dist in (30, 46, 64, 84, 110, 140):
                cands.append((mx + px * dist * sgn, my + py * dist * sgn))
        for voff in (-34, 34, -56, 56, -84, 84):
            cands.append((mx, my + voff))
    lx, ly = place_label(cands, flow["label"], 13)
    E(f'<text class="art-label halo" x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle">{escape(flow["label"])}</text>')

# day labels: on each limb just below its own day's band (where limbs are
# well separated), rotated along the limb but never steeper than +-58 degrees
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
    ang = max(-58, min(58, ang))
    E(f'<text class="day-name halo" x="{pt[0]:.1f}" y="{pt[1]:.1f}" text-anchor="middle" '
      f'transform="rotate({ang:.1f} {pt[0]:.1f} {pt[1]:.1f})">{escape(day["name"].upper())}</text>')
    E(f'<text class="day-sub halo" x="{pt[0]:.1f}" y="{pt[1] + 36:.1f}" text-anchor="middle">{escape(day["sub"])}</text>')

# scene clusters: labels, branchlets, leaves
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
                  f'fill="none" stroke="#86643c" stroke-width="2.6" stroke-linecap="round"/>')
                rot = LEAF_ROT[(leaf_no - 1) % len(LEAF_ROT)] * flip
                dark = shade(leaf["color"], 0.68)
                E(f'<g class="leaf" data-name="{escape(leaf["name"], quote=True)}" data-family="{escape(leaf["family"], quote=True)}">'
                  f'<title>{escape(leaf["label"])} — {escape(leaf["gloss"])}</title>'
                  f'<g transform="translate({bx:.1f} {ry - 5:.1f}) scale({flip} 1) rotate({rot})">'
                  f'<path d="M0,0 C8,-8.5 19,-10 30,0 C19,10 8,8.5 0,0 Z" fill="{leaf["color"]}" stroke="{dark}" stroke-width="1.2"/>'
                  f'<path d="M2.5,0 L26,0" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.4" fill="none"/>'
                  f'</g>'
                  f'<text class="lf-name" x="{text_x:.1f}" y="{ry:.1f}" text-anchor="{anchor}">{escape(leaf["label"])}</text>'
                  f'<text class="lf-gloss" x="{text_x:.1f}" y="{ry + 17:.1f}" text-anchor="{anchor}">{escape(leaf["gloss"])}</text>'
                  f'</g>')

# root plaque
root_text = "LocalNote — one week, one record"
pw = est_w(root_text, 25, True) + 58
E(f'<rect x="{base_cx - pw / 2:.1f}" y="{ground_y + 36:.1f}" width="{pw:.1f}" height="62" rx="18" '
  f'fill="#fffdf4" stroke="#d9b84a" stroke-width="2"/>')
E(f'<circle cx="{base_cx - pw / 2 + 24:.1f}" cy="{ground_y + 67:.1f}" r="4.5" fill="#d9b84a"/>')
E(f'<circle cx="{base_cx + pw / 2 - 24:.1f}" cy="{ground_y + 67:.1f}" r="4.5" fill="#d9b84a"/>')
E(f'<text class="root-label" x="{base_cx:.1f}" y="{ground_y + 76:.1f}" text-anchor="middle">{escape(root_text)}</text>')
E('</svg>')
svg = "\n".join(out)

# ----------------------------------------------------------------------------
# step 6: assemble the page (chrome/intro/legend/status/CTA/footer preserved)
# ----------------------------------------------------------------------------
src = PAGE.read_text(encoding="utf-8")
FIG_A, FIG_B = "<!-- TREE-FIGURE-START -->", "<!-- TREE-FIGURE-END -->"
if FIG_A in src:
    prefix = src[:src.index(FIG_A)]
    suffix = src[src.index(FIG_B) + len(FIG_B):]
else:
    prefix = src[:src.index('<div class="treewrap"')]
    suffix = src[src.index('<section class="container section narrow"><div class="status-note">'):]
    # drop the tree-only script (collapse + JS long links) from the suffix
    suffix = re.sub(r'<script>\s*\(\(\)=>\{\s*document\.querySelectorAll\(\'\.day-head\'\).*?</script>', '', suffix, flags=re.S)
    # drop the old root card and the expand/collapse controls from the prefix
    prefix = re.sub(r'<div class="treeroot">.*?</div><div class="legend"', '<div class="legend"', prefix, flags=re.S)
    prefix = re.sub(r'<div class="tcontrols">.*?</div>', '', prefix, flags=re.S)
    # fresh style block: shared mobile rules + legend + figure styles
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
    new_style = ("<style>" + shared_media + "\n"
        ".legend{display:flex;flex-wrap:wrap;gap:7px;margin:20px 0 4px}\n"
        ".legend .lg{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-weight:700;color:#454a60;border:1px solid var(--line);border-radius:99px;padding:5px 10px;background:#fff}\n"
        ".legend .dotp{width:9px;height:9px;border-radius:50%;background:var(--fc);flex:none;display:inline-block}\n"
        ".tree-wide{width:min(2180px,97.5vw);margin:0 auto;padding-bottom:10px}\n"
        ".tree-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}\n"
        ".treefig{margin:0}\n"
        ".treefig svg{display:block;width:100%;height:auto;min-width:1020px}\n"
        ".tree-cap{max-width:780px;margin:16px auto 0;text-align:center;color:var(--muted);font-size:.93rem;line-height:1.65}\n"
        "</style>")
    prefix = re.sub(r'<style>.*?</style>', new_style, prefix, count=1, flags=re.S)
    prefix += "</section>\n"

caption = ("Sunday night to Friday evening: a spoken intent becomes Monday&rsquo;s plan and brief, "
           "Tuesday&rsquo;s meeting, Wednesday&rsquo;s chase, Thursday&rsquo;s evidence and Friday&rsquo;s landing. "
           "The golden thread is the week itself, winding from the root through every scene in order. "
           "Follow the lines and you follow the whole product.")
figure = (FIG_A + "\n"
    '<section class="tree-wide"><div class="tree-scroll"><figure class="treefig">\n'
    + svg + "\n"
    f'<figcaption class="tree-cap">{caption}</figcaption></figure></div></section>\n'
    + FIG_B)

PAGE.write_text(prefix + figure + suffix, encoding="utf-8")
print(f"viewBox: {W:.0f} x {H:.0f} | rows: {[len(r) for r in rows]} | "
      f"canopy: {canopy_w:.0f} x {canopy_h:.0f} | leaves emitted: {leaf_no}")
print(f"tree.html written: {PAGE.stat().st_size} bytes")
