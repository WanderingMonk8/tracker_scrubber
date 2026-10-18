import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTagNames, scrubTaggedBlocks } from '../src/scrubber'

test('parses comma-separated tag names and removes duplicates case-insensitively', () => {
  assert.deepEqual(
    parseTagNames('tracker, STATE, tracker'),
    ['tracker', 'state'],
  )
})

test('requires commas between different tag names', () => {
  assert.throws(
    () => parseTagNames('tracker state'),
    /separated by commas/,
  )
  assert.throws(
    () => parseTagNames('tracker; state'),
    /separated by commas/,
  )
})

test('rejects markup and empty comma-separated entries', () => {
  assert.throws(
    () => parseTagNames('<tracker></tracker>'),
    /without < or >/,
  )
  assert.throws(
    () => parseTagNames('tracker,,state'),
    /separated by commas/,
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
