# HexSketch link and picture format

How a structure travels in a HexSketch link, in an image's alt text, and
inside a PNG. Any tool may write and read these: this document and the code
that implements it (`packages/core/src/link.ts`, `packages/core/src/payload.ts`)
are under the MIT License (`LICENSE-MIT`).

## Links

A link opens a structure in HexSketch, ready to edit. The structure is in the
URL fragment (after `#`), which browsers never send to a server.

```
https://hexsketch.com/#smiles=<SMILES>
https://hexsketch.com/#cdxml=<payload>
```

- **`smiles=`**: a SMILES string, percent-encoded (`encodeURIComponent`, or
  Python's `urllib.parse.quote(s, safe='')`). HexSketch lays it out fresh.
  Readers should also accept a SMILES written unencoded: if the percent-decoded
  text doesn't parse, try the text as written (`%12` is a ring closure in
  SMILES).
- **`cdxml=`**: a whole drawing (layout, style, captions, arrows) as a
  *payload* (below), or as percent-encoded CDXML text starting with `<`.
- Several `key=value` parts are separated by `&`; keys are case-insensitive.
  Values are not form-encoded: a `+` is a plus sign (SMILES charges), not a
  space.

## Payload

```
payload = base64url( deflate-raw( UTF-8 CDXML ) )
```

- CDXML is ChemDraw's XML format; HexSketch writes and reads it.
- `deflate-raw` is DEFLATE without a zlib or gzip header (RFC 1951;
  `CompressionStream('deflate-raw')`, or `zlib.compressobj(wbits=-15)`).
- `base64url` is RFC 4648 section 5: `-` and `_` for `+` and `/`, no `=`
  padding.
- A payload may contain `~` anywhere; readers delete every `~` before decoding.
  Writers put one in to break up `www`, `http` and `cid` (any case), which
  Word treats as a link and then deletes alt text over.

## Alt text

When HexSketch copies a picture into Word, PowerPoint or Google Docs, its alt
text is:

```
<name>

HexSketch:1:<payload>
```

The name comes first so screen readers announce something meaningful. It may
contain invisible U+2060 word joiners, for the same Word reason. Readers find
the marker `HexSketch:1:` anywhere in the text and take the base64url
characters (and `~`) after it. `DrawChem:1:`, an earlier name, is read too.

## PNG

PNGs exported or copied from HexSketch carry the same alt text in a `tEXt`
chunk with keyword `HexSketch` (earlier: `DrawChem`), placed right after
`IHDR`. The text is UTF-8 (strictly, `tEXt` is Latin-1; decode it as UTF-8).

## Example (Python, standard library only)

```python
import base64, re, urllib.parse, zlib

def smiles_link(smiles: str) -> str:
    return 'https://hexsketch.com/#smiles=' + urllib.parse.quote(smiles, safe='')

def cdxml_link(cdxml: str) -> str:
    c = zlib.compressobj(wbits=-15)
    raw = c.compress(cdxml.encode()) + c.flush()
    return 'https://hexsketch.com/#cdxml=' + base64.urlsafe_b64encode(raw).decode().rstrip('=')

def cdxml_from_payload(text: str) -> str:
    m = re.search(r'(?:HexSketch|DrawChem):1:([A-Za-z0-9_~-]+)', text)
    data = (m.group(1) if m else text).replace('~', '')
    return zlib.decompress(base64.urlsafe_b64decode(data + '=' * (-len(data) % 4)), wbits=-15).decode()
```
