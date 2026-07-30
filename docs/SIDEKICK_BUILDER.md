# Sidekick Builder

A DM's tool for running the sidekicks your players control: *Player menu → Sidekick Builder*
(`sidekick.html`). It is deliberately loose — nothing it fills in is locked, so you can bend any
number to fit the creature you actually have in mind.

## Building one

1. **Start from a stat block.** *Pick creature* opens the bestiary search. Choosing a creature
   seeds the sheet from it: ability scores, Armor Class, hit points, speed, skill and saving-throw
   proficiencies (inferred from its bonuses — a bonus around double the proficiency bonus is read
   as expertise), its senses, and its traits and actions as text.
2. **Give it a sidekick class.** *Expert*, *Spellcaster* or *Warrior*, from *Tasha's Cauldron of
   Everything*. The class drives the feature timeline exactly as it does for a player character,
   and the Spellcaster gets real spell slots.
3. **Set its level**, then **change whatever you like.** Every seeded field is an ordinary input.
   The traits box is free text, so "rebuilt as an automaton: immune to poison" is a legitimate
   edit.

A sidekick's **Hit Die comes from its stat block**, not from its class — the hit-point formula
(`2d8 + 2` → d8), or its size if the block gives a flat number. The sheet shows the expected
hit points per level next to the HP field as a suggestion.

If the creature you want isn't in the data (a homebrew automaton, say), pick the closest thing and
edit, or skip the creature step and type the numbers in directly.

## The levelling box

*How Sidekicks Level* lists all twenty levels with the features each one brings and the
proficiency bonus at that level. The current level is marked; the levels not yet reached are
dimmed. *Full rules* renders the book's own "Sidekicks" text, which covers the parts that are a
judgement call — when a sidekick levels up (with the party, at the group's average level) and what
it can and cannot do.

## Printing a card

*Print* uses the browser's print dialog, so "Save as PDF" is the export. A sidekick prints as a
**stat-block card**: name in small caps, red rules, abilities six across, and the full trait,
action and feature text. Reference material and every control is left out — the level table, the
buttons, the pickers.

The character pages (`charactersheet.html`, `charbuilder.html`) have the same button and print as
a plain sheet.

## Where the sidekick lives

Sidekicks share the character store with your characters, so they autosave and can be saved to and
loaded from a file the same way — but each page only lists its own kind. Your sidekicks appear in
the switcher here, never in the character sheet's.
