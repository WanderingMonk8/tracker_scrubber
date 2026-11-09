import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTagNames, parseTagPairs, scrubTaggedBlocks } from '../src/scrubber'

test('parses comma-separated tag names and removes duplicates case-insensitively', () => {
  assert.deepEqual(
    parseTagPairs('tracker, STATE, tracker'),
    [
      { open: 'tracker', close: 'tracker' },
      { open: 'state', close: 'state' },
    ],
  )
  assert.deepEqual(parseTagNames('tracker, STATE, tracker'), ['tracker', 'state'])
})

test('parses asymmetric open/close pairs', () => {
  assert.deepEqual(
    parseTagPairs('o_ledger/o_l, tracker, O_LEDGER / O_L'),
    [
      { open: 'o_ledger', close: 'o_l' },
      { open: 'tracker', close: 'tracker' },
    ],
  )
})

test('requires commas between different tag names', () => {
  assert.throws(
    () => parseTagPairs('tracker state'),
    /separated by commas/,
  )
  assert.throws(
    () => parseTagPairs('tracker; state'),
    /separated by commas/,
  )
})

test('rejects markup, empty entries, and malformed pairs', () => {
  assert.throws(
    () => parseTagPairs('<tracker></tracker>'),
    /without < or >/,
  )
  assert.throws(
    () => parseTagPairs('tracker,,state'),
    /separated by commas/,
  )
  assert.throws(() => parseTagPairs('tracker/'), /separated by commas/)
  assert.throws(() => parseTagPairs('/tracker'), /separated by commas/)
  assert.throws(() => parseTagPairs('open/middle/close'), /separated by commas/)
})

test('scrubs repeated multiline blocks while preserving surrounding text', () => {
  const input = [
    'Before',
    '<tracker>',
    'line one',
    'line two',
    '</tracker>',
    'Between <tracker>inline</tracker> after',
  ].join('\n')

  assert.deepEqual(scrubTaggedBlocks(input, ['tracker']), {
    text: 'Before\n\nBetween  after',
    removed: 2,
  })
})

test('matches opening-tag attributes and tag-name casing', () => {
  assert.deepEqual(
    scrubTaggedBlocks('A<Tracker type="status">secret</TRACKER>B', ['tracker']),
    { text: 'AB', removed: 1 },
  )
})

test('scrubs asymmetric tag pairs', () => {
  const input = [
    'Before',
    '<o_ledger type="status">',
    'line one',
    'line two',
    '</o_l>',
    'After <o_ledger>inline</o_l> end',
  ].join('\n')

  assert.deepEqual(
    scrubTaggedBlocks(input, parseTagPairs('o_ledger/o_l')),
    { text: 'Before\n\nAfter  end', removed: 2 },
  )
})

test('asymmetric pairs only match their configured closing tag', () => {
  const input = [
    '<o_ledger>kept</o_ledger>',
    '<o_ledger>removed</o_l>',
  ].join('\n')

  assert.deepEqual(
    scrubTaggedBlocks(input, parseTagPairs('o_ledger/o_l')),
    { text: '<o_ledger>kept</o_ledger>\n', removed: 1 },
  )
})

test('does not touch incomplete or unrelated tags', () => {
  const input = '<tracker>unfinished <other>safe</other>'
  assert.deepEqual(scrubTaggedBlocks(input, ['tracker']), { text: input, removed: 0 })
})
