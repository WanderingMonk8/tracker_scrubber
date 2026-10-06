import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTagPairs, scrubTaggedBlocks } from '../src/scrubber'

test('parses multiple tag pairs and removes duplicates case-insensitively', () => {
  assert.deepEqual(
    parseTagPairs('<tracker></tracker>, <STATE>example</STATE>, <tracker></tracker>'),
    ['tracker', 'state'],
  )
})

test('requires commas between different tracker pairs', () => {
  assert.throws(
    () => parseTagPairs('<tracker></tracker>\n<state></state>'),
    /Separate tracker pairs with commas/,
  )
  assert.throws(
    () => parseTagPairs('<tracker></tracker>; <state></state>'),
    /Separate tracker pairs with commas/,
  )
})

test('rejects incomplete tag pairs', () => {
  assert.throws(
    () => parseTagPairs('<tracker>'),
    /complete tag pairs/,
  )
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

test('does not touch incomplete or unrelated tags', () => {
  const input = '<tracker>unfinished <other>safe</other>'
  assert.deepEqual(scrubTaggedBlocks(input, ['tracker']), { text: input, removed: 0 })
})
