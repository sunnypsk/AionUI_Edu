import { catalogFixtures } from './catalog';

export const serverId = 'openui-browser-fixture';
const tool = (name: string): string =>
  `mcp.${Buffer.from(serverId).toString('base64url')}.${Buffer.from(name).toString('base64url')}`;

/** Real stdio fixture with a durable, test-owned write counter. */
export function fixtureServer(counter: string) {
  const script = `import json,sys
from pathlib import Path
state = Path(${JSON.stringify(counter)})
for line in sys.stdin:
    req = json.loads(line)
    if 'id' not in req: continue
    method = req['method']
    if method == 'initialize':
        result = {'protocolVersion':req['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'openui-qa','version':'1'}}
    elif method == 'tools/list':
        result = {'tools':[{'name':'read','inputSchema':{'type':'object'},'annotations':{'readOnlyHint':True}},{'name':'write','inputSchema':{'type':'object','properties':{'topic':{'type':'string'}}}}]}
    elif method == 'tools/call':
        data = json.loads(state.read_text()) if state.exists() else {'count':0}
        if req['params']['name'] == 'write':
            data['count'] += 1
            data['topic'] = req['params']['arguments'].get('topic','')
            state.write_text(json.dumps(data))
        result = {'content':[{'type':'text','text':'fixture'}],'structuredContent':{'title':'Fixture ready',**data},'isError':False}
    else: result = {}
    print(json.dumps({'jsonrpc':'2.0','id':req['id'],'result':result}),flush=True)
`;
  return {
    id: serverId,
    name: serverId,
    transport: { type: 'stdio', command: 'python3', args: ['-u', '-c', script], env: {} },
  };
}

/** Exercise the same official form fixtures as registry coverage, with live Core tool bindings. */
export function fixtureMessages(): string[] {
  const full = catalogFixtures('openui').fixtures;
  const form =
    full
      .find((fixture) => fixture.names.includes('Form'))!
      .program.replace(
        'root = Stack([',
        'root = Stack([TextContent(readResult.title), TextContent("Writes: " + readResult.count), '
      )
      .replace(
        'Button("Continue", @ToAssistant("Continue"))',
        'Button("Save fixture", Action([@Run(saveResult), @Run(readResult)])), Button("Continue", @ToAssistant("Continue"))'
      ) +
    `\nreadResult = Query(${JSON.stringify(tool('read'))}, {}, {title: "Loading fixture", count: 0})\nsaveResult = Mutation(${JSON.stringify(tool('write'))}, {topic: $topic})`;
  const modal = full
    .find((fixture) => fixture.names.includes('Modal'))!
    .program.replace(
      '[TextContent("Modal poem")]',
      '[TextContent("Modal poem"), Form("modalForm", Buttons([Button("Close lesson", @Set($open, false))]), [FormControl("Modal date", DatePicker("modalDate", "single")), FormControl("Modal class", Select("modalClass", [SelectItem("F1", "F1"), SelectItem("F2", "F2")], "Choose modal class"))])]'
    );
  const table = full
    .find((fixture) => fixture.names.includes('EditableTable'))!
    .program.replace(
      'options: [{value: "F1", label: "F1"}]',
      'options: [{value: "F1", label: "F1"}, {value: "F2", label: "F2"}]'
    );
  const charts = full.find((fixture) => fixture.names.includes('BarChart'))!.program;
  const tabs = full.find((fixture) => fixture.names.includes('Tabs'))!.program;
  const teacher = full.find((fixture) => fixture.names.includes('SlideOutline'))!.program;
  const chat = catalogFixtures('openui-chat').fixtures.find((fixture) => fixture.id === 'chat')!.program;
  const variants =
    'root = Stack([Form("variants", Buttons([Button("Check details")]), [FormControl("Email", Input("email", "Email", "email", {email: true})), FormControl("Password", Input("password", "Password", "password", {minLength: 8})), FormControl("Number", Input("number", "Number", "number", {numeric: true, min: 0, max: 100})), FormControl("URL", Input("url", "URL", "url", {url: true})), FormControl("Range", DatePicker("range", "range"))])])';
  return [
    `OpenUI browser acceptance — form and live MCP data.\n\n\`\`\`openui\n${form}\n\`\`\`\n\n\`\`\`openui\n${variants}\n\`\`\`\n\nA second interface follows.\n\n\`\`\`openui\n${modal}\n\`\`\``,
    `\`\`\`openui\n${table}\n\`\`\`\n\n\`\`\`openui\n${charts}\n\`\`\`\n\n\`\`\`openui\n${tabs}\n\`\`\`\n\n\`\`\`openui\n${teacher}\n\`\`\`\n\n\`\`\`openui-chat\n${chat}\n\`\`\``,
    `\`\`\`openui\nroot = Stack([TextContent(pending.title), Form("streaming", Buttons([Button("Streaming submit", @ToAssistant("Continue"))]), [FormControl("Streaming topic", Input("streamingTopic", "Streaming topic"))])])\npending = Query(${JSON.stringify(tool('read'))}, {}, {title: "Streaming preview"})`,
    '```openui\nroot = UnknownComponent("Invalid fixture")\n```',
  ];
}
