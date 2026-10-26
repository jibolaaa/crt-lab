"""Turn the yearly MT4 history files (15-minute EURUSD bid candles from
Dukascopy, published by the FX-Data project on GitHub) into one compact file
the page can load: public/data/eurusd-15m.bin plus a small JSON description.

Layout of the .bin (little-endian, column by column):
  Uint32 time[n]  (UTC seconds, start of each 15-minute candle)
  Float32 open[n], high[n], low[n], close[n]

Usage: python3 scripts/build_eurusd.py <folder with YEAR-EURUSD15.hst.gz> <out dir>
"""
import gzip, json, struct, sys
from array import array
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
rec = struct.Struct("<qddddqiq")
bars = {}
for f in sorted(src.glob("*-EURUSD15.hst.gz")):
    raw = gzip.open(f).read()
    assert struct.unpack_from("<i", raw, 0)[0] == 401, f
    for off in range(148, len(raw) - rec.size + 1, rec.size):
        t, o, h, l, c, *_ = rec.unpack_from(raw, off)
        t -= t % 900                      # a few stamps are a second late
        if not (0 < l <= o <= h and l <= c <= h):
            continue                      # drop broken rows
        if t in bars:                     # same slot twice: merge
            po, ph, pl, pc = bars[t]
            bars[t] = (po, max(ph, h), min(pl, l), c)
        else:
            bars[t] = (o, h, l, c)

times = sorted(t for t in bars if t >= 1388534400)  # from 2014; the 2014 file also holds a few months of 2013, then a gap
cols = [array("I", times)] + [array("f", (bars[t][k] for t in times)) for k in range(4)]
out.mkdir(parents=True, exist_ok=True)
with open(out / "eurusd-15m.bin", "wb") as fh:
    for col in cols:
        fh.write(col.tobytes())
meta = {
    "id": "eurusd-builtin", "symbol": "EURUSD", "name": "EUR/USD",
    "source": "Dukascopy bid prices via the FX-Data project on GitHub",
    "timeframe": 900, "count": len(times), "start": times[0], "end": times[-1],
    "pip": 0.0001, "digits": 5, "file": "eurusd-15m.bin"
}
(out / "eurusd-15m.json").write_text(json.dumps(meta, indent=2))
print(meta)
