---
name: runtime-probe
description: Reports facts about the code-execution sandbox (Node, the docx package, fonts, tools, writable folders). Use only when asked to run the runtime probe.
metadata:
  version: "0.0.1"
---

# Runtime probe

This is a throwaway skill for milestone M0 of `sales-proposal-builder`. It changes nothing.

1. Run `node scripts/probe.cjs` from this skill's folder. Use the absolute path to the script, and don't `cd` into the skill folder first. The probe needs to see the real working directory.
2. Reply with the script's complete JSON output in a single `json` code block, exactly as printed. Don't summarize it or leave anything out.
3. If the JSON says a test file was written to an outputs folder, mention the file name.
4. After the JSON, add one line giving the absolute path of this skill's folder.
