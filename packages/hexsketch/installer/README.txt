HexSketch for Claude Desktop
============================

Adds HexSketch to Claude Desktop, so Claude can draw, name and check
structures, and open the HexSketch editor inside the chat.

Before you start: if you installed the HexSketch extension, turn it off in
Claude: Settings > Extensions > HexSketch.

Mac
  1. Double-click the downloaded zip to unzip it (it makes a folder called
     hexsketch-mcp in Downloads).
  2. Open Terminal (press Cmd+Space, type Terminal, press Return).
  3. Paste this line and press Return:
       bash ~/Downloads/hexsketch-mcp/install.sh

Windows
  1. Right-click the downloaded zip > Extract All > Extract (it makes a
     folder called hexsketch-mcp in Downloads).
  2. Open PowerShell (press the Windows key, type PowerShell, press Enter).
  3. Paste this line and press Enter:
       powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\hexsketch-mcp\install.ps1"

The installer restarts Claude. Then start a new chat and ask:
  Open the HexSketch sketcher with ibuprofen
If Claude asks whether to show the app, click Allow.

It needs Node.js 20 or later; if that's missing, the installer opens the
download page and asks you to run it again afterwards. Claude's config file is
backed up next to itself as claude_desktop_config.json.before-hexsketch.
