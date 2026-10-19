import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, lstatSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const conversation = 'openui-upgrade-fixture';
const message = 'openui-legacy-message';
const attachmentText = '原有附件內容保持原樣。\n';

/** Build a version-43 fixture in this invocation's newly created database. */
export function prepareUpgradeFixture(data: string): { content: string; verify: () => void } {
  assert.equal(path.dirname(realpathSync(data)), realpathSync(os.tmpdir()));
  assert.match(path.basename(data), /^yuyu-openui-browser-[A-Za-z0-9]+$/);
  assert.equal(lstatSync(data).isSymbolicLink(), false);
  const attachment = path.join(data, '舊對話附件.txt');
  writeFileSync(attachment, attachmentText, { flag: 'wx' });
  const content = '原有課堂文字保持原樣。\n\n[[AION_FILES]]\n' + attachment;
  const db = path.join(data, 'aionui-backend.db');
  const script = `import json,sqlite3,sys
p=json.load(sys.stdin)
db=sqlite3.connect(p['db'])
assert db.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()[0] == 44
assert db.execute('SELECT COUNT(*) FROM conversations').fetchone()[0] == 0
assert db.execute('SELECT COUNT(*) FROM openui_states').fetchone()[0] == 0
db.execute('DROP TABLE openui_operations')
db.execute('DROP TABLE openui_states')
db.execute('DELETE FROM _sqlx_migrations WHERE version=44')
db.execute("INSERT INTO conversations (id,user_id,name,type,extra,created_at,updated_at) VALUES (?,'system_default_user','Upgrade fixture','acp',?,1,1)",(p['conversation'],json.dumps({'backend':'codex','workspace':p['data']})))
db.execute("INSERT INTO messages (id,conversation_id,msg_id,type,content,position,status,hidden,created_at) VALUES (?,?,?,'text',?,'right','finish',0,1)",(p['message'],p['conversation'],p['message'],json.dumps({'content':p['content']})))
db.execute("INSERT INTO client_preferences (user_id,key,value,updated_at) VALUES ('system_default_user','fixture.legacy.marker',?,1)",(json.dumps('retained'),))
db.commit()
assert db.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()[0] == 43
`;
  execFileSync('python3', ['-c', script], {
    input: JSON.stringify({ data, db, conversation, message, content }),
    stdio: 'pipe',
  });
  return {
    content,
    verify: () => {
      const result = execFileSync(
        'python3',
        [
          '-c',
          `import json,sqlite3,sys
db=sqlite3.connect(sys.argv[1])
assert db.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()[0] == 44
assert db.execute("SELECT value FROM client_preferences WHERE user_id='system_default_user' AND key='fixture.legacy.marker'").fetchone()[0] == json.dumps('retained')
assert db.execute("SELECT name FROM sqlite_master WHERE name='openui_states'").fetchone()
`,
          db,
        ],
        { stdio: 'pipe' }
      );
      assert.equal(result.length, 0);
      assert.equal(readFileSync(attachment, 'utf8'), attachmentText);
    },
  };
}

export const upgradeFixtureMessagePath = `/api/conversations/${conversation}/messages/${message}`;
