# Sidekick Builder

A DM's tool for running the sidekicks your players control: *Dungeon Master menu → Sidekick
Builder* (`sidekick.html`). It is deliberately loose — nothing it fills in is locked, so you can
bend any number to fit the creature you actually have in mind.

There are two published sidekick rulesets and the page supports both. Use whichever suits the
table; you can mix them.

## The Essentials Kit way (levels 1–6)

1. **Pick a sidekick type**: *Expert*, *Spellcaster* or *Warrior*. The page seeds the whole sheet
   from that type's stat block — abilities, AC, hit points, speed, proficiencies, senses, and its
   traits and actions.
2. **Pick its specialisation**, when it has one: a Spellcaster is a **Healer** or a **Mage**, a
   Warrior is an **Attacker** or a **Defender**. The choice is not cosmetic — it decides which of
   the stat block's entries apply (a Defender gets the *Protection* reaction; an Attacker does
   not) and, for a Spellcaster, which spell list and spellcasting ability it uses. Both roles'
   text is shown under the selects so you can compare before choosing.
3. **Level it up.** The *Levelling Up* box spells out the next level: the exact hit-point maximum
   the book gives it and the features it gains. One click sets the level, takes those hit points,
   and adds the features to Traits & Actions. Starting a sidekick above 1st level instead? The box
   offers to *catch it up* — every feature from level 2 to its level, and that level's hit points.

## The Tasha's way (levels 1–20)

1. **Start from any stat block.** *Pick creature* opens the bestiary search, and the chosen
   creature seeds the sheet the same way a sidekick type does. Skill and saving-throw
   proficiencies are inferred from its bonuses — a bonus around double the proficiency bonus is
   read as expertise.
2. **Give it a sidekick class** — *Expert*, *Spellcaster* or *Warrior Sidekick*. The class drives
   the feature timeline exactly as it does for a player character, and the Spellcaster gets real
   spell slots. This is also the way to take an Essentials Kit sidekick past 6th level.

A sidekick's **Hit Die comes from its stat block**, not from its class — the hit-point formula
(`2d8 + 2` → d8), or its size if the block gives a flat number. The sheet shows the expected
hit points per level next to the HP field as a suggestion.

If the creature you want isn't in the data (a homebrew automaton, say), pick the closest thing and
edit, or skip the picker and type the numbers in directly.

## Traits & Actions

Each trait, action, bonus action, reaction or feature is its own row: what kind it is, its name,
and its text. *Add* makes a blank one. A row granted by a level is tagged with that level. Every
row can be retitled, rewritten or deleted, wherever it came from — so turning a Guard into your
automaton is a matter of typing.

## The levelling box

For an Essentials Kit sidekick, the table lists levels 1–6 with the hit points and features each
brings; for a Tasha's one, all twenty levels with their features and proficiency bonus. The
current level is marked and the levels not yet reached are dimmed. *Full rules* renders the
matching book's own "Sidekicks" text, which covers the parts that are a judgement call — when a
sidekick levels up (with the party, at the group's average level) and what it can and cannot do.

Past 6th level, the Essentials Kit adventures reprint each sidekick at 7th, 9th and 11th level;
when your sidekick is at or past one of those, the box offers to seed it from that printed block.

## Printing a card

*Print* uses the browser's print dialog, so "Save as PDF" is the export. A sidekick prints as a
**stat-block card**: name in small caps, red rules, abilities six across, and each trait as a
stat block writes it — italic name, then its text. Reference material and every control is left
out: the level table, the buttons, the pickers.

The character pages (`charactersheet.html`, `charbuilder.html`) have the same button and print as
a plain sheet.

## Where the sidekick lives

Sidekicks share the character store with your characters, so they autosave and can be saved to and
loaded from a file the same way — but each page only lists its own kind. Your sidekicks appear in
the switcher here, never in the character sheet's.
