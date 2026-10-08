import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, privateEncrypt } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export function checkForge(directory) {
  const forge = createRequire(join(directory, 'package.json'))('./lib/index.js')
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString())
  const a = forge.asn1
  const seq = children => a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, children)
  const oid = value => a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(value).getBytes())
  const octets = value => a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, value)
  const nil = () => a.create(a.Class.UNIVERSAL, a.Type.NULL, false, '')
  for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
    const digest = forge.md[algorithm].create().update('Rue signature regression').digest().getBytes()
    const sign = (parameters, extra = []) => {
      const info = a.toDer(seq([seq([oid(forge.pki.oids[algorithm]), ...parameters]), octets(digest), ...extra])).getBytes()
      const encoded = '\x00\x01' + '\xff'.repeat(256 - info.length - 3) + '\x00' + info
      return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(encoded, 'binary')).toString('binary')
    }
    for (const parameters of [[], [nil()]]) {
      const signature = sign(parameters)
      assert.equal(key.verify(digest, signature), true)
      assert.equal(key.verify('\x00'.repeat(digest.length), signature), false)
      // This is a deliberately malformed signed block, not a claim to forge an e=3 key.
      assert.throws(() => key.verify(digest, sign([...parameters, octets('unconsumed garbage')])) , /DigestInfo/)
    }
    assert.throws(() => key.verify(digest, sign([nil()], [octets('outer garbage')])), /DigestInfo/)
  }
}

export function checkBraces(directory) {
  const braces = createRequire(join(directory, 'package.json'))('./index.js')
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [left, right] of [['{', '}'], ['(', ')']]) {
      assert.doesNotThrow(() => braces[method](left.repeat(100) + 'a' + right.repeat(100)))
      for (const depth of [101, 1000, 4000]) {
        assert.throws(() => braces[method](left.repeat(depth) + 'a' + right.repeat(depth)), /exceeds max depth/)
      }
      assert.throws(() => braces[method](left.repeat(2) + 'a' + right.repeat(2), { maxDepth: 1.5 }), /exceeds max depth/)
      assert.throws(() => braces[method](left.repeat(101) + 'a' + right.repeat(101), { maxDepth: Infinity }), /exceeds max depth/)
    }
  }
  for (const method of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'text', value: 'a' }
    for (let i = 0; i < 1000; i++) ast = { type: 'brace', nodes: [ast] }
    assert.throws(() => braces[method]({ type: 'root', nodes: [ast] }), /exceeds max depth/)
  }
  const cycle = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] }
  cycle.parent = cycle
  assert.throws(() => braces.expand(cycle), /parent chain contains a cycle/)
  assert.deepEqual(braces.expand('src/{api,web}/{a,b}.ts'), ['src/api/a.ts', 'src/api/b.ts', 'src/web/a.ts', 'src/web/b.ts'])
  assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)'])
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}', '{1..8}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern)
  }
  assert.deepEqual(braces.expand('x{1..3}'), ['x1', 'x2', 'x3'])
}

if (process.argv[2] === '--check') {
  const check = process.argv[3] === 'node-forge' ? checkForge : process.argv[3] === 'braces' ? checkBraces : undefined
  if (!check) throw new Error('Unknown backport')
  check(process.argv[4])
}
