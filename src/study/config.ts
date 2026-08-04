/**
 * Study content for the Transformer Explainer control arm.
 *
 * THIS IS THE ONLY FILE THAT NEEDS EDITING TO CHANGE STUDY CONTENT.
 * Everything else in `src/study/` is plumbing.
 *
 * Content status: STUB — adapted from the facilitator deck at
 * `workbench-workshops/slides/02b-arm-transformer-explainer.md` so the shape is
 * real and testable, but the wording, the concept callouts and every check
 * answer still need Gwen's pass before launch.
 *
 * Two hard constraints when editing:
 *
 *  1. PROMPTS MUST BE <= 11 WORDS. `InputForm.svelte` sets `wordLimit = 12` and
 *     blocks input at `split(' ').length >= 12`, so a 12-word prompt cannot be
 *     submitted. `npm run test:unit` enforces this.
 *
 *  2. EVERY PROMPT MUST BE LIVE-VERIFIED against the built app's GPT-2 before
 *     launch. GPT-2 is brittle: the Jun 9 session showed `Rome is in` does NOT
 *     reliably predict " Italy". Verify with:
 *
 *       REAL_MODEL=1 npx playwright test tests/real-model.spec.ts
 *
 *     and iterate on replacements without editing this file using
 *     PROMPT_CANDIDATES='first prompt|second prompt'.
 *
 * A NOTE ON DETERMINISM, because it changes what a check can ask:
 * Transformer Explainer SAMPLES. `predictedToken` is `randomChoice()` over the
 * top-k distribution at temperature 0.8 (src/utils/data.ts), so the token TE
 * displays varies between runs of the same prompt. The tutorial spec's premise
 * that embedded checks are auto-scorable "because greedy decoding makes answers
 * deterministic" (§4.7) is true of the Workbench arm but NOT of TE.
 *
 * `top-token` checks are therefore graded against the rank-0 (highest
 * probability) token, which IS deterministic, and their wording must ask about
 * the top-ranked/most-likely token — never "what did the model output", which
 * has no stable answer here.
 *
 * The unit list is matched 1:1 against the Workbench arm's tutorial units 0-6
 * (`workbench-workshops/prolific-tutorial-design-spec.md` §3) so the two arms
 * have the same number of activities and the same time budget. Unit 4 is the
 * deliberate exception — see its comment.
 */

export type StudyCheck =
	| {
			/** Fixed options; correctness is independent of what the model does. */
			kind: 'choice';
			question: string;
			options: string[];
			correctIndex: number;
	  }
	| {
			/**
			 * Answerable only by running the tool — the TE-paper engagement-check
			 * technique. Graded against the model's live top predicted token.
			 */
			kind: 'top-token';
			question: string;
			/** For content review only; grading uses the live prediction. */
			expectedTopToken?: string;
	  };

export type StudyUnit = {
	/** Stable id — written to `te_events.step_id`. Never renumber after launch. */
	id: string;
	title: string;
	/** What the participant is asked to do. */
	task: string;
	/** The conceptual point, replacing a facilitator move. */
	callout: string;
	/** Inserted into the input box by the "Use this prompt" button. <= 11 words. */
	prompt?: string;
	check: StudyCheck;
	/** Shown as "optional" and skippable without a completed event. */
	optional?: boolean;
};

export const STUDY_UNITS: StudyUnit[] = [
	{
		id: 'u0-orientation',
		title: 'Orientation',
		task: 'Run the prompt below, then find the ranked list of predicted next tokens at the right-hand end of the diagram.',
		callout:
			'The model predicts just the NEXT token — not a whole answer. Everything you see between the input and that ranked list is how it gets there.',
		prompt: 'The Eiffel Tower is in the city of',
		check: {
			kind: 'top-token',
			// VERIFIED 2026-08-04 against the real GPT-2: rank-0 token is " Paris".
			question: 'Look at the ranked list. What is the HIGHEST-PROBABILITY next token?',
			expectedTopToken: ' Paris'
		}
	},
	{
		id: 'u1-where-answers-come-from',
		title: 'Where answers come from',
		task: 'Look at the ranked list again. Note the second-place token as well as the first.',
		callout:
			"It didn't look this up. It produced the most likely next token from patterns in its training data — and it always has a runner-up.",
		// CONTENT NOTE (verified 2026-08-04): rank-0 is " a", which makes for a
		// dull demonstration — the unit wants a prompt where the top token is a
		// recognisable opinion/recall answer with a visible runner-up. Works
		// mechanically; worth Gwen replacing for pedagogy.
		prompt: 'The best football player of all time is',
		check: {
			kind: 'choice',
			question: 'The output at the end of the model is best described as:',
			options: [
				'A single retrieved fact',
				'A ranked list of possible next tokens, with probabilities',
				'A summary of pages the model searched',
				'A random word'
			],
			correctIndex: 1
		}
	},
	{
		id: 'u2-what-the-model-knows',
		title: 'What the model knows',
		task: 'Run this prompt and look at which earlier words the attention view connects to.',
		callout:
			'When you run a prompt, the model has only two things: what it was pre-trained on, and what is in this prompt. Nothing else. It cannot remember you.',
		// CONTENT NOTE (verified 2026-08-04): rank-0 is " the". The point of the
		// unit is that the model cannot recall a conversation that never happened,
		// so a bland continuation actually demonstrates it — but check with Gwen
		// that participants will read it that way rather than as a broken tool.
		prompt: 'As we discussed earlier, my favourite colour is',
		check: {
			kind: 'choice',
			question: 'Why can the model not recall what you told it a moment ago?',
			options: [
				'It is still loading',
				'It only sees its training data and the current prompt',
				'It forgot on purpose',
				'It needs a bigger temperature'
			],
			correctIndex: 1
		}
	},
	{
		id: 'u3-patterns-beat-facts',
		title: 'Patterns beat facts',
		task: 'Run this prompt, which shows the model one worked example before asking its question.',
		callout:
			'The example is not teaching the model. It is just more input — and the model continues the pattern it sees. Change the input, steer the output.',
		/*
		 * VERIFIED 2026-08-04 against the real GPT-2: rank-0 token is " Italy",
		 * and the sampled token was " Italy" too, so the pattern is strong enough
		 * that TE will usually display the "right" answer as well.
		 *
		 * Note for anyone reading the Jun 9 note that `Rome is in` does not predict
		 * " Italy": that concern does not reproduce for THIS prompt. The full
		 * few-shot form ("Paris is in France." prepended) is what makes it work —
		 * which is exactly the lesson this unit teaches.
		 */
		prompt: 'Paris is in France. Rome is in',
		check: {
			kind: 'top-token',
			question: 'After adding the example, what is the highest-probability token?',
			expectedTopToken: ' Italy'
		}
	},
	{
		/*
		 * NOT matched to the Workbench arm's unit 4 ("Move a thought" — activation
		 * patching), and deliberately so. Transformer Explainer has no intervention
		 * capability; interventions are precisely what the Workbench arm is being
		 * tested for. Faking one here would destroy the contrast the study exists to
		 * measure, so this slot is instead the deepest architecture unit — which is
		 * what TE is actually best at. Keep this asymmetry, and state it in the
		 * methods section.
		 */
		id: 'u4-inside-a-block',
		title: 'Inside a block',
		task: 'Click into one transformer block. Follow a single token through attention, then through the MLP.',
		callout:
			'Each block reads the whole sequence through attention, then processes each position through an MLP. Stacking twelve of these is the entire model.',
		check: {
			kind: 'choice',
			question: 'What does the attention step let each token do?',
			options: [
				'Look at other tokens in the sequence',
				'Look up an answer on the web',
				'Change the model weights',
				'Add more tokens to the prompt'
			],
			correctIndex: 0
		}
	},
	{
		id: 'u5-explore',
		title: 'Explore',
		task: 'Try the temperature slider and the sampling control with any prompt you like. Watch what happens to the ranked list.',
		callout:
			'Temperature does not make the model smarter or more truthful. It only reshapes how sharply the probability is concentrated on the top tokens.',
		optional: true,
		check: {
			kind: 'choice',
			question: 'Raising the temperature makes the model:',
			options: [
				'More accurate',
				'More likely to pick lower-ranked tokens',
				'Faster',
				'Able to remember more'
			],
			correctIndex: 1
		}
	},
	{
		id: 'u6-final-challenge',
		title: 'Final challenge',
		task: 'Find a short prompt where the model is confidently wrong — a top prediction that is clearly incorrect but has a high probability.',
		callout:
			'Confidence is not correctness. A high probability means the token fits the pattern, not that the statement is true.',
		check: {
			kind: 'choice',
			question: 'A high-probability top token means:',
			options: [
				'The model is sure the statement is true',
				'The token fits the learned pattern well',
				'The answer was verified',
				'The prompt was well written'
			],
			correctIndex: 1
		}
	}
];

/** Written to `te_events.payload.arm` and `te_sessions.arm`. */
export const STUDY_ARM = 'transformer_explainer';
