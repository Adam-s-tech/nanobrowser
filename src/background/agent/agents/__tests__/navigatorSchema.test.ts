import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../types';
import { Action } from '../../actions/builder';
import { clickElementActionSchema, doneActionSchema, goBackActionSchema } from '../../actions/schemas';
import { buildNavigatorJsonSchema, NavigatorActionRegistry } from '../navigator';
import { validateNavigatorOutput } from '../navigatorOutput';
import { generateStructured, jsonSchema } from '@src/background/llm/generate';
import { userMessage } from '@src/background/llm/messages';
import { mockChatModel, toolCallResult } from '@src/background/llm/__tests__/mockModel';

type Schema = Record<string, unknown>;

const handler = async () => new ActionResult();

function buildRegistry() {
  return new NavigatorActionRegistry([
    new Action(handler, doneActionSchema),
    new Action(handler, clickElementActionSchema, true),
  ]);
}

function actionProperties(schema: Schema): Record<string, Schema> {
  const action = (schema.properties as Record<string, Schema>).action;
  return (action.items as Schema).properties as Record<string, Schema>;
}

describe('buildNavigatorJsonSchema', () => {
  it('converts the registered actions with titles and nullable anyOf branches', () => {
    const schema = buildNavigatorJsonSchema(buildRegistry().setupModelOutputSchema()) as Schema;

    expect(schema.required).toEqual(['current_state', 'action']);
    const actions = actionProperties(schema);
    expect(Object.keys(actions)).toEqual(['done', 'click_element']);

    const done = actions.done;
    expect(done.title).toBe('Done');
    expect(done.description).toBe(doneActionSchema.description);
    expect(done.anyOf).toContainEqual({ type: 'null' });

    const doneObject = (done.anyOf as Schema[]).find(branch => branch.type === 'object')!;
    expect((doneObject.properties as Record<string, Schema>).text.title).toBe('Text');

    const json = JSON.stringify(schema);
    expect(json).not.toContain('"nullable"');
    expect(json).not.toContain('"$ref"');
  });

  it('includes actions registered before the schema is built', () => {
    const registry = buildRegistry();
    registry.registerAction(new Action(handler, goBackActionSchema));
    const schema = buildNavigatorJsonSchema(registry.setupModelOutputSchema()) as Schema;
    expect(Object.keys(actionProperties(schema))).toEqual(['done', 'click_element', 'go_back']);
  });

  it('keeps unknown action names when the reply is validated leniently', async () => {
    const schema = jsonSchema(buildNavigatorJsonSchema(buildRegistry().setupModelOutputSchema()), {
      validate: validateNavigatorOutput,
    });
    const reply = {
      current_state: { evaluation_previous_goal: 'ok', memory: 'm', next_goal: 'g' },
      action: [{ fly_to_moon: { speed: 'fast' } }],
    };
    const { chatModel } = mockChatModel(toolCallResult('navigator_output', reply), 'tool');
    const { output } = await generateStructured({
      chatModel,
      messages: [userMessage('state')],
      schema,
      name: 'navigator_output',
    });
    expect(output).toEqual(reply);
  });
});
