from pathlib import Path
import re

p = Path(r"c:\src\jaswave-ia\jas-wave\components\arrangement\ArrangementView.tsx")
text = p.read_text(encoding="utf-8")

if "ArrangeBoard" not in text:
    text = text.replace(
        "import { TrackCanvas } from './TrackCanvas'\n",
        "import { TrackCanvas } from './TrackCanvas'\n"
        "import { ArrangeBoard } from './ArrangeBoard'\n",
    )

idx_col = text.find("      {/* Columna de cabeceras de pista */}")
idx_confirm = text.find("      <ConfirmDialog")
if idx_col < 0 or idx_confirm < 0:
    raise SystemExit("markers missing")

# Toolbar inner (children of HEADER_H bar)
t0 = text.find("        {/* Acciones superiores")
t1 = text.find("        {/* Cabeceras", t0)
toolbar_block = text[t0:t1]
m = re.search(
    r"style=\{\{ height: HEADER_H \}\}>(.*)</div>\s*\n\s*\n",
    toolbar_block,
    re.S,
)
if not m:
    raise SystemExit("toolbar extract failed")
toolbar_inner = m.group(1)

# Headers rows
h0 = text.find("          {tracks.length === 0 && (", t1)
h1 = text.find("          </div>\n        </TrackHeaderPanel>", h0)
if h1 < 0:
    h1 = text.find("        </TrackHeaderPanel>", h0)
headers_inner = text[h0:h1]

# Lanes body
l0 = text.find('            <div className="relative cursor-pointer" data-track-area>')
l1 = text.find("          </div>\n          </div>\n        </TrackCanvas>", l0)
if l1 < 0:
    raise SystemExit("lanes end missing")
lanes_inner = text[l0:l1]

prefix = text[:idx_confirm]
# dialogs / file input stay between confirm and col
dialogs = text[idx_confirm:idx_col]

new_layout = f"""    <div className="flex min-h-0 flex-1 w-full overflow-hidden">
{dialogs}      <ArrangeBoard
        tracksHeight={{tracksHeight}}
        contentWidth={{contentWidth}}
        scrollRef={{lanesScrollRef}}
        extraRef={{timelineRef}}
        onScroll={{syncFromLanes}}
        onPointerMove={{(e) => {{
            if (lanesScrollRef.current) {{
              lastPointerXRef.current =
                e.clientX - lanesScrollRef.current.getBoundingClientRect().left
            }}
            handleTimelinePointerMove(e)
          }}}}
        onPointerUp={{handleTimelinePointerUp}}
        onPointerLeave={{() => {{}}}}
        onWheel={{handleZoom}}
        headerToolbar={{(
          <>
{toolbar_inner}
          </>
        )}}
        ruler={{(
          <div
            ref={{rulerScrollRef}}
            className="jw-scroll-hide-x h-full overflow-x-hidden overflow-y-hidden"
          >
            <div
              className="relative cursor-pointer select-none"
              style={{{{ width: `${{contentWidth}}px`, height: HEADER_H, minWidth: '100%' }}}}
              onClick={{handleSeek}}
            >
              <TimelineRuler
                projection={{viewProjection}}
                zoom={{zoom}}
                totalHeight={{HEADER_H}}
                bpm={{bpm}}
                beatsPerBar={{beatsPerBar}}
                viewportWidth={{viewportWidth}}
                height={{HEADER_H}}
              />
              <PlayheadOverlay
                getSeconds={{getPlayheadSeconds}}
                bpm={{bpm}}
                beatToPixel={{beatToPixel}}
                onPointerDown={{handlePlayheadPointerDown}}
              />
            </div>
          </div>
        )}}
        headers={{(
          <>
{headers_inner}
          </>
        )}}
        lanes={{(
          <>
{lanes_inner}
          </>
        )}}
      />
    </div>
"""

outer_end = text.rfind("    </div>\n  )\n}")
idx_inner_start = text.find('    <div className="flex min-h-0 flex-1 w-full overflow-hidden">')
if idx_inner_start < 0:
    raise SystemExit("inner start missing")

text2 = text[:idx_inner_start] + new_layout + text[outer_end:]
# drop unused TrackHeaderPanel import usage is fine if unused - remove import
text2 = text2.replace("import { TrackHeaderPanel } from './TrackHeaderPanel'\n", "")
# TrackCanvas may still be used only via ArrangeBoard
if "TrackCanvas" in text2 and text2.count("TrackCanvas") == 1:
    text2 = text2.replace("import { TrackCanvas } from './TrackCanvas'\n", "")

p.write_text(text2, encoding="utf-8")
print("OK", p.stat().st_size)
PY