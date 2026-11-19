import{afterEach,expect,it,vi}from'vitest';import{chat,json,reactionPath}from'./api';import{clearAccess,configureEndpoint,rememberAccess}from'../../lib/transport';
afterEach(()=>{clearAccess();vi.unstubAllGlobals();});
it('validates released native conversation schemas without credentials in resource URLs',async()=>{configureEndpoint('chattermost','/api/chat');rememberAccess('chattermost','obviously-fake-access',Date.now()+60000);const send=vi.fn<typeof fetch>().mockImplementation(async path=>String(path).endsWith('/auth/oathweave/session')?Response.json({expires_at:Date.now()+60000}):Response.json({not:'native-user'}));vi.stubGlobal('fetch',send);await expect(chat('/users/me')).rejects.toThrow('unsupported response');await expect(chat('/unknown')).rejects.toThrow('released contract');expect(send.mock.calls.every(([path])=>!String(path).includes('obviously-fake'))).toBe(true);});
it('encodes every segment of a reaction removal path', () => {
  expect(reactionPath('user 1', 'post/2', '../x?y#z')).toBe('/users/user%201/posts/post%2F2/reactions/..%2Fx%3Fy%23z');
  expect(reactionPath('u1', 'p1', 'thumbsup')).toBe('/users/u1/posts/p1/reactions/thumbsup');
});
it('refuses reaction names the released contract rejects before sending them', async () => {
  configureEndpoint('chattermost', '/api/chat'); rememberAccess('chattermost', 'obviously-fake-access', Date.now() + 60000);
  const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
  vi.stubGlobal('fetch', send);
  await expect(chat('/reactions', json({ user_id: 'u1', post_id: 'p1', emoji_name: '../x' }))).rejects.toThrow('product contract');
  expect(send).not.toHaveBeenCalled();
});
