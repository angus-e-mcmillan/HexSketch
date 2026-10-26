# Launch notes

For after the connector works in Claude. Everything here is built around a
short video of the in-chat editor, which the owner records.

## The video (30 to 45 seconds, no voice-over needed)

1. A new Claude chat. Type *Open HexSketch with ibuprofen*. The editor opens
   beside the chat.
2. Draw a change by hand (for example, turn the acid into a methyl ester) and
   ask *What did I just make, and how would I make it?*
3. Claude answers in the editor: the ester highlighted, then the scheme with
   reagents and conditions on the arrow.
4. End on the scheme, with the title "Chemists think in sketches. LLMs think
   in text." and `hexsketch.com/ai`.

Record it in full screen at 1080p with the Claude desktop app, and trim the
waiting. A GIF of the same clip (under 10 MB) goes at the top of the README.

## Show HN

**Title:** Show HN: HexSketch – a chemical structure editor that Claude can draw in

**Text:**
Chemists think in structures, and AI assistants still answer
chemistry questions with SMILES strings and paragraphs, or with images nobody
can edit.

HexSketch is a structure editor (hexsketch.com, free, runs in the browser)
that is also an MCP server. Add it to Claude as a connector and the editor
opens inside the chat: you draw, Claude sees the drawing, and Claude answers
by drawing back, with highlights, notes, and reaction schemes with the
reagents and conditions written on the arrows.

Some of the details: naming is offline IUPAC, written from scratch in
TypeScript; every SMILES the model writes is checked before you see it;
related compounds in a scheme are drawn the same way round (substructure
alignment); pictures copied into Word or PowerPoint carry the structure inside
them, so they paste back for editing.

Setup is a URL: https://hexsketch.com/ai. Source:
https://github.com/angus-e-mcmillan/HexSketch. I'd love feedback from
chemists on what it gets wrong.

## r/chemistry (and r/OrganicChemistry, r/cheminformatics)

**Title:** I made a free structure editor that lets Claude draw schemes with you in the chat

**Text:** two or three sentences from the Show HN text, the video, and the
setup link. Ask a question to start the thread: *What reaction would you test
it on first?*

## Bluesky and X

1. The video, with: "Chemists think in sketches. LLMs think in text.
   HexSketch lets you talk to Claude with structures. Free, nothing to
   install: hexsketch.com/ai"
2. The sitagliptin scheme picture: "Every reaction is a proper scheme:
   reagents above the arrow, conditions below, each compound the same way
   round."
3. "Draw in HexSketch, paste into Word, copy it back: the structure travels
   inside the picture."
4. A link to the repo.
