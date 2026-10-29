// 测试用 MCP 服务（stdio）：echo 回显参数并带上环境变量 ECHO_TOKEN 是否收到；add 做加法；fail 返回工具错误。
const sdk = name => require(require.resolve(`@modelcontextprotocol/sdk/${name}`, { paths: [require('path').join(__dirname, '../../backend')] }));
const { Server } = sdk('server/index.js');
const { StdioServerTransport } = sdk('server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = sdk('types.js');

const server = new Server({ name: 'echo', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
    { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } }
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;
    if (name === 'echo') return { content: [{ type: 'text', text: `echo: ${args.text} (token ${process.env.ECHO_TOKEN ? 'received' : 'missing'}; platform secret ${process.env.TOOLS_TEST_PLATFORM_SECRET ? 'leaked' : 'not passed'})` }] };
    if (name === 'add') return { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] };
    return { content: [{ type: 'text', text: 'boom' }], isError: true };
});
server.connect(new StdioServerTransport());
