# Phrase-level AI collaboration

## Partnership

The AI proposes the accompaniment's phrase-by-phrase dynamic arc and instrument entrances. The engine writes pitches, rhythms and voice leading using its existing arrangers; it then applies the reviewed plan to accompaniment and runs the normal source-preservation and MusicXML/MIDI/playback checks. No AI-generated code or raw MusicXML is executed or inserted.

This first implementation supports **string ensemble with automatic instrumentation and a preservable source melody**. It does not generate new AI countermelody notes, change harmony, alter the source, or add arbitrary phrasing/dynamics to the protected melody. Supported controls are `pp`, `p`, `mp`, `mf` and entrances/rests for Violin II, Viola and Double Bass; the source melody and Cello stay available throughout. Existing engine writing may itself contain rests. These controls support a restrained worship/orchestral arc without introducing unvalidated notes.

## Browser workflow

1. Load MusicXML and select string ensemble. Keep source preservation enabled.
2. Choose **Inspect phrases**. This inspects the actual selected source, including melody pitches/timing, lyrics, chord symbols, keys, meter, directions and repeat information. It creates an editable starting plan without calling an AI.
3. Edit the plan directly, or enter a musical direction and choose **Ask Claude for a proposal**. This explicitly sends the inspected summary and direction to the configured provider. It does not apply the returned plan.
4. Review each phrase's instruments, dynamic and reason. Select **Use this reviewed plan for the next arrangement**, then generate normally.
5. The result reports the applied phrase count, source preservation and playback status. The API result also contains the exact applied plan for auditing/replay.

Editing a plan clears its review checkbox. Changing source, selected parts or settings invalidates it. Turn off the checkbox to return to ordinary engine generation. Provider failure never silently applies an alternative AI plan.

## Collaborating outside the app

**Export brief and plan** downloads JSON containing the inspected score summary, schema instructions and current plan. Give that file to a collaborator (including an AI chat), ask for a revised plan, and use **Import a collaborator’s plan**. Import accepts either a plan object or the exported wrapper containing `plan`. The server validates it against the current score/settings before it appears in the editor. Imported plans still require review before generation. This works without provider credentials.

The browser has the review interface. Desktop does not yet have a phrase-plan editor; its standard arrangement workflow remains unchanged. The same generation API accepts plans for integrations and scripts.

## API and configuration

- `POST /phrase_context`: `{musicxml, settings, partIds?}` → `{ok, context, plan, aiUsed:false}`. Include `phrasePlan` to validate an imported plan against freshly inspected context.
- `POST /propose_phrase_plan`: same input plus `brief` → a validated proposal. `ANTHROPIC_API_KEY` is required. `PHRASE_AI_MODEL` optionally overrides the model already used by the existing AI integration (`claude-haiku-4-5`). Credentials remain server-side. The request has a 60-second provider timeout and no automatic retries.
- `POST /generate` (or its MusicXML aliases): include `phrasePlan` to apply it. Omit it for existing behavior. Request chord overrides cannot be combined with a phrase plan; it uses the source's chords.

No live provider call is required by tests. Provider tests inject responses and check both acceptance and rejection. No real AI service was called during implementation verification.

## Validation and musical limits

Plans are versioned and bound by SHA-256 to the selected source XML and normalized settings. Their keys, phrase count/order/bounds, dynamics and accompaniment names are strictly checked. A plan cannot target Violin I or disable source preservation, and Cello cannot be removed. Stale, partial, overlapping, malformed and unsupported plans fail explicitly before arrangement; there is no silent fallback.

Boundaries are **written-measure working groups**, based on source rests, fermatas and repeats, with a four-bar fallback that avoids splitting a source tie at the fallback boundary. This is a heuristic, not authoritative phrase analysis. Bounds are fixed for a given inspected context; the editor changes musical decisions within those groups. Repeat passes reuse the same written-bar plan; different first/second-pass orchestration is not supported. Scores are limited to 128 written measures and a bounded summary size.

Inactive accompaniment parts receive correctly timed rests. Disconnected tie endpoints at entrances are cleared while valid ties and the protected melody remain intact. Dynamics are applied per accompaniment staff, then the ordinary exporter and performance compiler create matching outputs. Source verification still checks melody, chords, lyrics, keys, meter, form and notation. Musical balance and the quality of AI suggestions still need listening; passing preservation tests is not a composition-quality certificate.
