import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionResult, type AgentContext } from '../../types';
import { Action } from '../../actions/builder';
import { clickElementActionSchema, doneActionSchema } from '../../actions/schemas';
import type { BasePrompt } from '../../prompts/base';
import { NavigatorActionRegistry, NavigatorAgent } from '../navigator';
import { PlannerAgent, plannerOutputSchema } from '../planner';
import { ResponseParseError } from '../errors';
import { AGENT_OUTPUT_TOOL_NAME, toolCallMessage, toolResultMessage, userMessage } from '@src/background/llm/messages';
import { type MockResult, mockChatModel, textResult, toolCallResult } from '@src/background/llm/__tests__/mockModel';

const handler = async () => new ActionResult();

const history = [
  userMessage('task'),
  toolCallMessage({ toolCallId: '1', input: { current_state: {}, action: [] } }),
  toolResultMessage({ toolCallId: '1', content: 'Browser started' }),
  userMessage('state'),
];

// Strings that the text parser would strip or split on; tool input must keep them as they are
const trickyText = 'Result:\n```js\nconsole.log(1);\n```\n<think>kept</think> and a stray </think> too';

const navigatorReply = {
  current_state: { evaluation_previous_goal: 'Success', memory: 'm', next_goal: 'finish' },
  action: [{ done: { text: trickyText, success: true } }],
};

const plannerReply = {
  observation: 'o',
  challenges: 'none',
  done: true,
  next_steps: 'none',
  final_answer: trickyText,
  reasoning: 'r',
  web_task: true,
};

function agentOptions(result: MockResult, mode: 'tool' | 'text' = 'tool') {
  const { chatModel, model } = mockChatModel(result, mode);
  const options = {
    chatLLM: chatModel,
    context: { controller: new AbortController() } as unknown as AgentContext,
    prompt: {} as BasePrompt,
  };
  return { options, model };
}

function createNavigator(result: MockResult) {
  const registry = new NavigatorActionRegistry([
    new Action(handler, doneActionSchema),
    new Action(handler, clickElementActionSchema, true),
  ]);
  const { options, model } = agentOptions(result);
  return { agent: new NavigatorAgent(registry, options), model };
}

describe('structured tool name in tool mode', () => {
  it('navigator offers the AgentOutput tool recorded in its history and keeps strings exactly', async () => {
    const { agent, model } = createNavigator(toolCallResult(AGENT_OUTPUT_TOOL_NAME, navigatorReply));
    const output = await agent.invoke(history);

    expect(output).toEqual(navigatorReply);
    const call = model.doGenerateCalls[0];
    expect(call.tools?.map(t => t.name)).toEqual([AGENT_OUTPUT_TOOL_NAME]);
    expect(call.toolChoice).toEqual({ type: 'tool', toolName: AGENT_OUTPUT_TOOL_NAME });
  });

  it('planner keeps its own tool name', async () => {
    const { options, model } = agentOptions(toolCallResult('planner_output', plannerReply));
    const output = await new PlannerAgent(options).invoke(history);

    expect(output).toEqual(plannerReply);
    expect(model.doGenerateCalls[0].tools?.map(t => t.name)).toEqual(['planner_output']);
  });

  it.each([
    ['planner', plannerReply],
    ['navigator', navigatorReply],
  ])('planner rejects a %s-shaped AgentOutput call', async (_, reply) => {
    const { options } = agentOptions(toolCallResult(AGENT_OUTPUT_TOOL_NAME, reply));
    await expect(new PlannerAgent(options).invoke(history)).rejects.toBeInstanceOf(ResponseParseError);
  });
});

describe('planner output schema', () => {
  it('fills string fields a text-mode reply omits, such as final_answer while not done', async () => {
    const reply: Partial<typeof plannerReply> = { ...plannerReply };
    delete reply.final_answer;
    const { options } = agentOptions(textResult(JSON.stringify(reply)), 'text');
    expect(await new PlannerAgent(options).invoke(history)).toEqual({ ...reply, final_answer: '' });
  });

  it('joins a list sent for a string field, such as next_steps', async () => {
    const reply = { ...plannerReply, done: false, next_steps: ['Open the repo', 'Check the star button'] };
    const { options } = agentOptions(textResult(JSON.stringify(reply)), 'text');
    expect(await new PlannerAgent(options).invoke(history)).toEqual({
      ...reply,
      next_steps: 'Open the repo\nCheck the star button',
    });
  });

  it('still rejects a missing boolean field', async () => {
    const reply: Partial<typeof plannerReply> = { ...plannerReply };
    delete reply.web_task;
    const { options } = agentOptions(textResult(JSON.stringify(reply)), 'text');
    await expect(new PlannerAgent(options).invoke(history)).rejects.toBeInstanceOf(ResponseParseError);
  });

  it('keeps every field required with a plain string type in the schema sent to models', () => {
    // The AI SDK converts zod schemas with io: 'input'
    const schema = z.toJSONSchema(plannerOutputSchema, { io: 'input', unrepresentable: 'any' }) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required.sort()).toEqual(Object.keys(plannerOutputSchema.shape).sort());
    expect(schema.properties.final_answer).toEqual({ type: 'string' });
    // Some OpenRouter providers fail on type arrays such as ["boolean", "string"]
    expect(schema.properties.done).toEqual({ type: 'boolean' });
    expect(schema.properties.web_task).toEqual({ type: 'boolean' });
  });

  it('accepts booleans sent as strings', async () => {
    const reply = { ...plannerReply, done: 'False', web_task: 'TRUE' };
    const { options } = agentOptions(textResult(JSON.stringify(reply)), 'text');
    expect(await new PlannerAgent(options).invoke(history)).toEqual({ ...plannerReply, done: false, web_task: true });
  });

  it('rejects a string that is not a boolean', async () => {
    const reply = { ...plannerReply, done: 'maybe' };
    const { options } = agentOptions(textResult(JSON.stringify(reply)), 'text');
    await expect(new PlannerAgent(options).invoke(history)).rejects.toBeInstanceOf(ResponseParseError);
  });
});
