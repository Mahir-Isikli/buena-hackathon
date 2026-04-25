# Buena PM interview, verbatim

Date: 2026-04-25 (Saturday, hackathon day 1)
Source: in-person conversation, transcribed from voice notes
Participants: Mahir, Anwar, Yasin, Buena PM (intro via Linus from Buena)

This file captures the **exact answers** the PM gave us. No paraphrasing. Use as ground truth when interpreting later decisions.

---

## Q1: Pivot focus

**Q:** You're pivoting from PM companies to home ownership, right? Do you want us to focus on the old vertical or more on the new focus?

**A:** Doesn't matter.

---

## Q2: What "winning" looks like

**Q:** What does a win look like for you in this challenge, high level?

**A:** If new data comes in, it should not fall everything again. Something that works properly. If one new email is coming in, it shouldn't check all historic emails again. It should get the context only from the new email.

**Follow-up Q:** Only the specific email, or the specific user, or the specific property, or what?

**A:** Depends.

---

## Q3: Shape of incoming data

**Q:** When you onboard a new user or a new home, what is the shape of the data arriving? Where does it come from, which platforms?

**A:** Mostly PDF, actually, from the old property management company. Sometimes you have JSON or these v-files, but mostly PDF.

**Follow-up Q:** Where is it stored? Is it just by email that they share it?

**A:** Yeah, it's coming per email. Sometimes it's actually a paper document you need to scan.

---

## Q4: Storage when buying a whole company

**Q:** Imagine you're buying a new home property management company. Where is the data stored? Do they have a OneDrive? Are the files just local?

**A:** Mostly, if we buy the whole company, it's an ERP system. They're like seven to ten ERP systems, and then it's like Microsoft SQL databases, Firebird database, stuff like that.

---

## Q5: Markdown and Obsidian

**Q:** Do you guys already use Markdown internally?

**A:** Yes.

**Follow-up Q:** Do you use Obsidian already?

**A:** We are pretty heavy Obsidian users. That's why the output being markdown is also so valuable. If you find a better solution, go for it. Markdown is working quite well for us right now.

---

## Q6: Non-negotiable fields

**Q:** What fields are non-negotiable in the context file you recreate? Owner, WEG, contractors, open issues, that kind of thing?

**A:** False positive is the worst thing that could happen.

---

## Q7: Update triggers

**Q:** What are the triggers for updates in your real workflows right now? Inbound emails, transactional bank account?

**A:** Email coming in. Transactional bank account coming in.

---

## Q8: Systems used for context files today

**Q:** What systems are you using for the context files?

**A:** We are just exploring that right now, so I don't want to get into it too much.

---

## Q9: Inbound relevance

**Q:** Of all the inbound items you get, how much is actually relevant to a property file right now?

**A:** 95% is relevant.

**Follow-up Q:** And the 5% that is not relevant, what is that?

**A:** Usually spam or just updates.

---

## Q10: Human-edit conflict behaviour

**Q:** When a human edits the file, how do you want the engine to behave on the next conflicting update? Should it block that edit, or queue for review from a human in the loop?

**A:** (no clear answer captured, conversation moved on)

---

## Q11: Where the engine lives

**Q:** Where would this engine live within your stack?

**A:** Doesn't matter.

---

## Q12: Data we should not use

**Q:** Any data we should not train or evaluate on for this demo, like legal or PII concerns?

**A:** Doesn't matter at all.

---

## Q13: Surface preference

**Q:** Any preference besides this, dynamic web app or iOS, where should this live? What workflows would make more sense?

**A:** (no clear preference captured)

---

## Implications we drew (not from him, our own synthesis)

These are **our interpretations**, not the PM's words. Kept separate so we can revisit if we misread:

- Heavy Obsidian use means the output should be a vault folder of markdown files with frontmatter and wikilinks, not a custom UI.
- "False positives are the worst" means precision over recall on every patch. Never patch on uncertainty. Route ambiguous cases to a human review queue.
- "Don't reprocess everything" validates our surgical-update thesis. Scope retrieval to the resolved property, never global.
- PDF-dominant input means OCR plus vision is the critical path, not Gmail parsing.
- 7 to 10 ERPs in the M&A case justifies our schema-alignment work. Mock 2 to 3 ERPs in the demo.

---

*If you re-read this and remember he said something different, fix it here. This file is supposed to be ground truth.*
