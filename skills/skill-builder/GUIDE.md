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

**Some material is generated rather than shipped, and the manifest should
say which.** The Tutorial skill's click ticks and zoom air are rendered
from oscillators at build time and written into the take's own folder, so
they travel with the recording rather than with the skill: nothing to
licence, nothing to 404. That is a real answer to "slot or asset?" and it
is a third one. `assets: []` cannot tell it apart from "nobody thought
about it", which is the same complaint that manifest makes about leaving
`trial` out.

**Anything with a licence gets a `description` that says so.** A skill
that quietly ships music somebody else owns is a problem you have handed
to whoever runs it.

## Slots

**A skill with no slots is refused**, by `create_skill`, on purpose. It is
the single reliable sign that the content was never separated out.

- `kind` must be one of `folder`, `file`, `string`, `number`, `boolean`,
  `colour` or `enum`. A kind nothing recognises gives the person filling
  it in no control and no validation.
- `kind: "enum"` **must** carry `options`, and its `default` must be one
  of them. Without the list it is a free text field that fails on the
  fifth character somebody types; with a default outside the list, the
  one value guaranteed to be used is the one value guaranteed to be
  invalid.
- Every slot needs a `description`. The person filling it in has nothing
  else to go on.
- Give a `default` to everything that can have one. A skill with eight
  required slots is a form, and nobody fills in a form to make a video.
- Prefer a slot over an asset when the answer is *personal* (their
  footage, their brand colour) and an asset when it is *editorial* (the
  sting that makes this look like your work).

**`requiresSlot` when one slot is meaningless without another.** The
Tutorial skill has three of these around one switch: with `captions`
off, `language` does nothing, `cleanCaptions` does nothing, and the
camera stops opening on an introduction. Before the field existed a
caller could set all three and have nothing anywhere tell them why none
of them took effect.

It states a DEPENDENCY, not a constraint. A dependent slot whose parent
is off is inert rather than an error, because refusing the combination
would break anybody who sets a language once and toggles captions per
take. What it buys is an interface that can grey the slot out and an
agent that can be told why the argument it passed did nothing.

### What else is refused, and why the list is mechanical

Everything above is about your judgement. These are facts the app
already has, and it checks them because the alternative is a skill that
fails at run time in front of whoever bought it:

- a recipe step naming a tool this build does not have;
- `{slot:something}` where no slot is called `something`;
- two slots with the same id, so `{slot:id}` cannot say which it means;
- `requiresSlot` pointing at a slot that does not exist.

One thing is **warned about and not refused**: a slot that no recipe step
and no guide mentions. It is usually a rename that only got done on one
side, but `recipe` is a specification an agent carries out rather than
something the app runs, so an agent can act on a slot the guide only
describes in prose. The warning comes back on `create_skill`; read it.

## The recipe

Steps in the only order that can work, each naming a real tool. Refer to
a slot as `{slot:id}`.

Order is not a formality. In the Tutorial skill the transcript has to
exist before the camera cuts are placed, and the cuts before the zooms
chain around them; exposing those as three steps a caller could reorder
would let somebody run them in an order that cannot work and call the
result a skill. If two steps have a real dependency, they are one step.

## The fields that are not slots

`create_skill` also takes the parts of the format that are not inputs,
and it is worth knowing they exist because a skill without them is
three-quarters of a skill:

| | |
|---|---|
| `verify` | A test inside the skill folder. HANDOVER §6's definition is tools **plus assets plus a template plus a test**, and this is the part that says the other three work. |
| `template` | A project the recipe opens first. The floor under a fumbled run: something real is left on the timeline either way. Not every skill can have one — the Tutorial skill's canvas is not knowable until the take is read. |
| `trial` | How many runs a publisher allows before the skill is bought. `0` means NOT GATED, and is deliberately different from leaving it out. |
| `toolApi` | Manifest compatibility version. The shipped skills use `1`. |
| `provenance` | Who built it, with what, when, and what it was verified on. |

`verify` and `template` name FILES, and `create_skill` writes a manifest
rather than files. Declare them, then put the files there; `create_skill`
returns `declaredButNotOnDisk` and `list_skills` keeps reporting them
until they exist, the same way a declared asset is reported.

## What Kerf does not do yet

**There is no skill runner.** `recipe` is a specification and nothing in
the app executes it — the Tutorial skill runs through its own tool, not
through its recipe. So what you are building is a specification plus its
material, which an agent reads and carries out step by step with the
tools the recipe names.

Say this to the user when you finish. A skill that looks executable and
is not would be the second version of the mistake at the top of this
document.
