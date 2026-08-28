# Turning a project into a skill

Read this before calling `create_skill`. It is the method, and the method
is mostly a conversation.

## The one mistake

Every failed attempt at a skill fails the same way: **it rebuilds the
video it was made from.** Somebody points the builder at a project they
like, the builder writes down what the project contains, and the result
is a saved project wearing a skill's clothes. Run it and you get the same
video again.

The difference between a project and a skill is not the file format. It
is whether the CONTENT has been separated from the STRUCTURE.

| | Keep it | Ask for it |
|---|---|---|
| Track stack and what each track is for | ✅ structure | |
| Cut rhythm, hold lengths, transition grammar | ✅ structure | |
| Grade, backdrop, corner radius, inset | ✅ structure | |
| Where captions sit and how they are styled | ✅ structure | |
| How the camera behaves | ✅ structure | |
| The footage | | ❌ content |
| The words on screen | | ❌ content |
| The music | | ❌ content, usually |
| The logo | | ❌ content, usually a shipped asset |
| Brand colours | | ❌ content, usually a slot with a default |

`inspect_project_for_skill` marks each asset with a `likelyRole`. That is
a hint from how often the asset is used, not a decision. **You have to
ask.** Only the author knows whether the music is "the sound of this
brand" (ship it) or "what I happened to use" (slot it).

## The interrogation

Work through these in order. Do not skip to `create_skill`; a manifest
written without this conversation is the mistake above.

**1. What does the new skill MAKE?**
One line, for somebody who has never seen this project. "A 30-second
product demo from a screen recording" is a purpose. "Something like this
video" is not, and if that is the answer, keep asking.

**2. Which assets are the subject, and which are the look?**
Go through the asset list out loud. For each one: *if somebody else ran
this skill, would they bring their own, or would they expect this one?*
Their own → a slot. This one → an asset the skill ships with.

**3. What must the person supply that this project did not need?**
The hardest question and the one that makes a skill general. This project
had exactly what it had. A skill that only accepts the same shape of
input is barely a skill. If it opens on a title card, does the next
person supply their own, or a line of text you render into one? If it
cuts to a face, what happens when there is no camera?

**4. What should it refuse?**
A skill that produces something bad rather than saying no is worse than
one that says no. Write the refusals into `guide`.

**5. What does good output look like?**
Also into `guide`, so the next agent can tell whether it succeeded.

## How assets are standardised

This is the part that decides whether a skill still works in six months.

**Assets are COPIED into the skill, never referenced.** `add_skill_asset`
copies the file into `<skill>/assets/`. A skill that points at
`~/Desktop/track.mp3` breaks the first time that file moves, and it
breaks *silently at run time* rather than loudly when you build it.

**Declare every asset in the manifest.** Each entry is
`{ id, file, kind, description }`. `file` is a path inside the skill
folder — `assets/bed.mp3`, not an absolute path. `list_skills` reports
declared assets that are not on disk, so a half-built skill is visible
instead of failing later.

**Name assets by their ROLE, not by what they are.** `music-bed`, not
`upbeat-corporate-3`. The id is what the recipe refers to and what the
next person replaces; a role survives a change of taste and a filename
does not.

**Kinds worth using consistently**, so a skill reads the same as the ones
that ship: `audio` for beds and stings, `image` for logos and overlays,
`video` for footage, `lut` for a grade, `font` for a typeface, `json` for
anything structured.

**Anything with a licence gets a `description` that says so.** A skill
that quietly ships music somebody else owns is a problem you have handed
to whoever runs it.

## Slots

**A skill with no slots is refused**, by `create_skill`, on purpose. It is
the single reliable sign that the content was never separated out.

- `kind: "enum"` **must** carry `options`. Without it, it is a free text
  field that fails on the fifth character somebody types.
- Every slot needs a `description`. The person filling it in has nothing
  else to go on.
- Give a `default` to everything that can have one. A skill with eight
  required slots is a form, and nobody fills in a form to make a video.
- Prefer a slot over an asset when the answer is *personal* (their
  footage, their brand colour) and an asset when it is *editorial* (the
  sting that makes this look like your work).

## The recipe

Steps in the only order that can work, each naming a real tool. Refer to
a slot as `{slot:id}`.

Order is not a formality. In the Tutorial skill the transcript has to
exist before the camera cuts are placed, and the cuts before the zooms
chain around them; exposing those as three steps a caller could reorder
would let somebody run them in an order that cannot work and call the
result a skill. If two steps have a real dependency, they are one step.

## What Kerf does not do yet

**There is no skill runner.** `recipe` is a specification and nothing in
the app executes it — the Tutorial skill runs through its own tool, not
through its recipe. So what you are building is a specification plus its
material, which an agent reads and carries out step by step with the
tools the recipe names.

Say this to the user when you finish. A skill that looks executable and
is not would be the second version of the mistake at the top of this
document.
