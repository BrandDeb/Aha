/**
 * Real project templates, one per language: a small command-line tool split
 * into a library and a program, with unit tests in the language's usual test
 * framework and a CI workflow that runs them (the studio adds it from
 * lib/pipelines when the project is created). Run works without arguments,
 * and the Pipelines tab runs the tests locally.
 *
 * Every one is the same program, "wordstats": it reads a text file (sample.txt
 * by default) and prints the line count, the word count and the three most
 * frequent words, so they are easy to compare and to test.
 */

export interface ProjectTemplate {
  id: string;
  name: string;
  /** languages.ts id, or 'python' */
  language: string;
  description: string;
  /** Entry file */
  filename: string;
  files: Record<string, string>;
  /** How its tests run (what the CI workflow does), for the description */
  tests: string;
}

/** What every template prints when run without arguments */
export const WORDSTATS_OUTPUT = ['lines: 3', 'words: 19', 'top: the 4, fox 3, dog 2'];

export const PROJECT_SAMPLE = 'The quick brown fox jumps over the lazy dog.\nThe dog sleeps; the fox runs.\nA fox is quick.\n';

export const projectReadme = (lang: string, run: string, test: string) => `# wordstats (${lang})

Counts the lines and words of a text file and shows the three most frequent words.

- Run: press Run (reads sample.txt), or \`${run}\` with a file of your own
- Test: \`${test}\`, or Pipelines → Run all (the CI workflow in .github/workflows/ runs the same tests)

Words are runs of letters, digits and apostrophes, compared in lower case; ties are listed alphabetically.
`;

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'proj-node-wordstats',
    name: 'Node.js · CLI with tests',
    language: 'node',
    description: 'A word-count tool split into a module and a CLI, tested with node:test, with CI',
    tests: 'node --test',
    filename: 'main.js',
    files: {
      'main.js': `const { readFileSync } = require('node:fs');
const { stats, format } = require('./wordstats');

const file = process.argv[2] ?? 'sample.txt';
console.log(format(stats(readFileSync(file, 'utf8'))));
`,
      'wordstats.js': `/** Lines, words and how often each word appears */
function stats(text) {
  const lines = text === '' ? 0 : text.replace(/\\n$/, '').split('\\n').length;
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return { lines, words: words.length, counts };
}

/** The n most frequent words; ties in alphabetical order */
function top(counts, n) {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

function format(s) {
  return [\`lines: \${s.lines}\`, \`words: \${s.words}\`, \`top: \${top(s.counts, 3).map(([w, c]) => \`\${w} \${c}\`).join(', ')}\`].join('\\n');
}

module.exports = { stats, top, format };
`,
      'test/wordstats.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const { stats, top } = require('../wordstats');

test('counts lines and words, case-insensitively', () => {
  const s = stats('Hello, hello world!\\n');
  assert.equal(s.lines, 1);
  assert.equal(s.words, 3);
  assert.equal(s.counts.get('hello'), 2);
});

test('ties are alphabetical', () => {
  assert.deepEqual(top(new Map([['b', 2], ['a', 2], ['c', 1]]), 2), [['a', 2], ['b', 2]]);
});

test('empty text', () => {
  const s = stats('');
  assert.equal(s.lines, 0);
  assert.equal(s.words, 0);
});
`,
      'package.json': `${JSON.stringify({ name: 'wordstats', version: '1.0.0', private: true, scripts: { start: 'node main.js', test: 'node --test' } }, null, 2)}\n`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Node.js', 'node main.js notes.txt', 'npm test'),
    },
  },
  {
    id: 'proj-python-wordstats',
    name: 'Python · CLI with tests',
    language: 'python',
    description: 'A word-count tool as a package and a CLI, tested with pytest, managed by uv, with CI',
    tests: 'uv run pytest',
    filename: 'main.py',
    files: {
      'main.py': `import sys

from wordstats import format_stats, stats

path = sys.argv[1] if len(sys.argv) > 1 else "sample.txt"
with open(path, encoding="utf-8") as f:
    print(format_stats(stats(f.read())))
`,
      'wordstats.py': `"""Lines, words and how often each word appears."""

import re
from collections import Counter
from dataclasses import dataclass


@dataclass
class Stats:
    lines: int
    words: int
    counts: Counter


def stats(text: str) -> Stats:
    lines = 0 if text == "" else len(text.removesuffix("\\n").split("\\n"))
    words = re.findall(r"[a-z0-9']+", text.lower())
    return Stats(lines, len(words), Counter(words))


def top(counts: Counter, n: int) -> list[tuple[str, int]]:
    """The n most frequent words; ties in alphabetical order."""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def format_stats(s: Stats) -> str:
    best = ", ".join(f"{w} {c}" for w, c in top(s.counts, 3))
    return f"lines: {s.lines}\\nwords: {s.words}\\ntop: {best}"
`,
      'tests/test_wordstats.py': `from collections import Counter

from wordstats import stats, top


def test_counts_lines_and_words_case_insensitively():
    s = stats("Hello, hello world!\\n")
    assert (s.lines, s.words, s.counts["hello"]) == (1, 3, 2)


def test_ties_are_alphabetical():
    assert top(Counter({"b": 2, "a": 2, "c": 1}), 2) == [("a", 2), ("b", 2)]


def test_empty_text():
    s = stats("")
    assert (s.lines, s.words) == (0, 0)
`,
      'pyproject.toml': `[project]
name = "wordstats"
version = "0.1.0"
description = "Counts lines and words in a text file"
requires-python = ">=3.11"
dependencies = []

[dependency-groups]
dev = ["pytest>=8"]

[tool.pytest.ini_options]
pythonpath = ["."]
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Python', 'uv run main.py notes.txt', 'uv run pytest'),
    },
  },
  {
    id: 'proj-go-wordstats',
    name: 'Go · CLI with tests',
    language: 'go',
    description: 'A word-count tool as a package and a command, tested with go test, with CI',
    tests: 'go test ./...',
    filename: 'main.go',
    files: {
      'main.go': `package main

import (
	"fmt"
	"os"

	"example.com/wordstats/stats"
)

func main() {
	path := "sample.txt"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	text, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(stats.Format(stats.Count(string(text))))
}
`,
      'stats/stats.go': `// Package stats counts lines and words and how often each word appears.
package stats

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type Stats struct {
	Lines  int
	Words  int
	Counts map[string]int
}

type Entry struct {
	Word  string
	Count int
}

var word = regexp.MustCompile("[a-z0-9']+")

func Count(text string) Stats {
	lines := 0
	if text != "" {
		lines = len(strings.Split(strings.TrimSuffix(text, "\\n"), "\\n"))
	}
	words := word.FindAllString(strings.ToLower(text), -1)
	counts := map[string]int{}
	for _, w := range words {
		counts[w]++
	}
	return Stats{Lines: lines, Words: len(words), Counts: counts}
}

// Top returns the n most frequent words; ties in alphabetical order.
func Top(counts map[string]int, n int) []Entry {
	entries := make([]Entry, 0, len(counts))
	for w, c := range counts {
		entries = append(entries, Entry{w, c})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Count != entries[j].Count {
			return entries[i].Count > entries[j].Count
		}
		return entries[i].Word < entries[j].Word
	})
	if len(entries) > n {
		entries = entries[:n]
	}
	return entries
}

func Format(s Stats) string {
	parts := []string{}
	for _, e := range Top(s.Counts, 3) {
		parts = append(parts, fmt.Sprintf("%s %d", e.Word, e.Count))
	}
	return fmt.Sprintf("lines: %d\\nwords: %d\\ntop: %s", s.Lines, s.Words, strings.Join(parts, ", "))
}
`,
      'stats/stats_test.go': `package stats

import (
	"reflect"
	"testing"
)

func TestCountsLinesAndWordsCaseInsensitively(t *testing.T) {
	s := Count("Hello, hello world!\\n")
	if s.Lines != 1 || s.Words != 3 || s.Counts["hello"] != 2 {
		t.Fatalf("got %+v", s)
	}
}

func TestTiesAreAlphabetical(t *testing.T) {
	got := Top(map[string]int{"b": 2, "a": 2, "c": 1}, 2)
	want := []Entry{{"a", 2}, {"b", 2}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEmptyText(t *testing.T) {
	if s := Count(""); s.Lines != 0 || s.Words != 0 {
		t.Fatalf("got %+v", s)
	}
}
`,
      'go.mod': 'module example.com/wordstats\n\ngo 1.22\n',
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Go', 'go run . notes.txt', 'go test ./...'),
    },
  },
  {
    id: 'proj-rust-wordstats',
    name: 'Rust · CLI with tests',
    language: 'rust',
    description: 'A word-count tool as a library crate and a binary, tested with cargo test, with CI',
    tests: 'cargo test',
    filename: 'src/main.rs',
    files: {
      'src/main.rs': `use std::{env, fs, process};

fn main() {
    let path = env::args()
        .nth(1)
        .unwrap_or_else(|| "sample.txt".to_string());
    let text = fs::read_to_string(&path).unwrap_or_else(|err| {
        eprintln!("{path}: {err}");
        process::exit(1);
    });
    println!("{}", wordstats::format(&wordstats::stats(&text)));
}
`,
      'src/lib.rs': `//! Lines, words and how often each word appears.

use std::collections::HashMap;

pub struct Stats {
    pub lines: usize,
    pub words: usize,
    pub counts: HashMap<String, usize>,
}

pub fn stats(text: &str) -> Stats {
    let lines = if text.is_empty() {
        0
    } else {
        text.strip_suffix('\\n').unwrap_or(text).split('\\n').count()
    };
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '\\''))
        .filter(|w| !w.is_empty())
        .collect();
    let mut counts = HashMap::new();
    for w in &words {
        *counts.entry(w.to_string()).or_insert(0) += 1;
    }
    Stats {
        lines,
        words: words.len(),
        counts,
    }
}

/// The n most frequent words; ties in alphabetical order.
pub fn top(counts: &HashMap<String, usize>, n: usize) -> Vec<(String, usize)> {
    let mut entries: Vec<(String, usize)> = counts.iter().map(|(w, c)| (w.clone(), *c)).collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(n);
    entries
}

pub fn format(s: &Stats) -> String {
    let best: Vec<String> = top(&s.counts, 3)
        .into_iter()
        .map(|(w, c)| format!("{w} {c}"))
        .collect();
    format!(
        "lines: {}\\nwords: {}\\ntop: {}",
        s.lines,
        s.words,
        best.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_lines_and_words_case_insensitively() {
        let s = stats("Hello, hello world!\\n");
        assert_eq!((s.lines, s.words, s.counts["hello"]), (1, 3, 2));
    }

    #[test]
    fn ties_are_alphabetical() {
        let counts = HashMap::from([
            ("b".to_string(), 2),
            ("a".to_string(), 2),
            ("c".to_string(), 1),
        ]);
        assert_eq!(
            top(&counts, 2),
            vec![("a".to_string(), 2), ("b".to_string(), 2)]
        );
    }

    #[test]
    fn empty_text() {
        let s = stats("");
        assert_eq!((s.lines, s.words), (0, 0));
    }
}
`,
      'Cargo.toml': '[package]\nname = "wordstats"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Rust', 'cargo run -- notes.txt', 'cargo test'),
    },
  },
  {
    id: 'proj-java-wordstats',
    name: 'Java · CLI with tests',
    language: 'java',
    description: 'A Maven project: a word-count class and a CLI, tested with JUnit 5, with CI',
    tests: 'mvn -B verify',
    filename: 'src/main/java/dev/example/wordstats/Main.java',
    files: {
      'src/main/java/dev/example/wordstats/Main.java': `package dev.example.wordstats;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) throws IOException {
        String path = args.length > 0 ? args[0] : "sample.txt";
        System.out.println(WordStats.format(WordStats.of(Files.readString(Path.of(path)))));
    }
}
`,
      'src/main/java/dev/example/wordstats/WordStats.java': `package dev.example.wordstats;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Lines, words and how often each word appears. */
public record WordStats(int lines, int words, Map<String, Integer> counts) {
    private static final Pattern WORD = Pattern.compile("[a-z0-9']+");

    public static WordStats of(String text) {
        int lines = text.isEmpty() ? 0 : text.replaceAll("\\n$", "").split("\\n", -1).length;
        Map<String, Integer> counts = new TreeMap<>();
        int words = 0;
        Matcher m = WORD.matcher(text.toLowerCase());
        while (m.find()) {
            counts.merge(m.group(), 1, Integer::sum);
            words++;
        }
        return new WordStats(lines, words, counts);
    }

    /** The n most frequent words; ties in alphabetical order. */
    public static List<Map.Entry<String, Integer>> top(Map<String, Integer> counts, int n) {
        List<Map.Entry<String, Integer>> entries = new ArrayList<>(counts.entrySet());
        entries.sort(Comparator.<Map.Entry<String, Integer>>comparingInt(e -> -e.getValue()).thenComparing(Map.Entry::getKey));
        return entries.subList(0, Math.min(n, entries.size()));
    }

    public static String format(WordStats s) {
        String best = top(s.counts(), 3).stream().map(e -> e.getKey() + " " + e.getValue()).collect(Collectors.joining(", "));
        return "lines: " + s.lines() + "\\nwords: " + s.words() + "\\ntop: " + best;
    }
}
`,
      'src/test/java/dev/example/wordstats/WordStatsTest.java': `package dev.example.wordstats;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class WordStatsTest {
    @Test
    void countsLinesAndWordsCaseInsensitively() {
        WordStats s = WordStats.of("Hello, hello world!\\n");
        assertEquals(1, s.lines());
        assertEquals(3, s.words());
        assertEquals(2, s.counts().get("hello"));
    }

    @Test
    void tiesAreAlphabetical() {
        assertEquals(List.of(Map.entry("a", 2), Map.entry("b", 2)), WordStats.top(Map.of("b", 2, "a", 2, "c", 1), 2));
    }

    @Test
    void emptyText() {
        WordStats s = WordStats.of("");
        assertEquals(0, s.lines());
        assertEquals(0, s.words());
    }
}
`,
      'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.example</groupId>
  <artifactId>wordstats</artifactId>
  <version>0.1.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.4</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
    </plugins>
  </build>
</project>
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Java', 'mvn -q compile exec:java -Dexec.mainClass=dev.example.wordstats.Main -Dexec.args=notes.txt', 'mvn verify'),
    },
  },
  {
    id: 'proj-ruby-wordstats',
    name: 'Ruby · CLI with tests',
    language: 'ruby',
    description: 'A word-count library and a CLI, tested with Minitest through Rake, with CI',
    tests: 'bundle exec rake test',
    filename: 'main.rb',
    files: {
      'main.rb': `require_relative 'lib/wordstats'

path = ARGV[0] || 'sample.txt'
puts WordStats.format(WordStats.stats(File.read(path)))
`,
      'lib/wordstats.rb': `# Lines, words and how often each word appears.
module WordStats
  Stats = Struct.new(:lines, :words, :counts)

  def self.stats(text)
    lines = text.empty? ? 0 : text.chomp.split("\\n", -1).length
    words = text.downcase.scan(/[a-z0-9']+/)
    Stats.new(lines, words.length, words.tally)
  end

  # The n most frequent words; ties in alphabetical order.
  def self.top(counts, n)
    counts.sort_by { |word, count| [-count, word] }.first(n)
  end

  def self.format(s)
    best = top(s.counts, 3).map { |word, count| "#{word} #{count}" }.join(', ')
    "lines: #{s.lines}\\nwords: #{s.words}\\ntop: #{best}"
  end
end
`,
      'test/wordstats_test.rb': `require 'minitest/autorun'
require_relative '../lib/wordstats'

class WordStatsTest < Minitest::Test
  def test_counts_lines_and_words_case_insensitively
    s = WordStats.stats("Hello, hello world!\\n")
    assert_equal [1, 3, 2], [s.lines, s.words, s.counts['hello']]
  end

  def test_ties_are_alphabetical
    assert_equal [['a', 2], ['b', 2]], WordStats.top({ 'b' => 2, 'a' => 2, 'c' => 1 }, 2)
  end

  def test_empty_text
    s = WordStats.stats('')
    assert_equal [0, 0], [s.lines, s.words]
  end
end
`,
      Gemfile: "source 'https://rubygems.org'\n\ngem 'minitest', '~> 5.25'\ngem 'rake', '~> 13.2'\n",
      Rakefile: "require 'rake/testtask'\n\nRake::TestTask.new(:test) do |t|\n  t.test_files = FileList['test/**/*_test.rb']\nend\n\ntask default: :test\n",
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Ruby', 'ruby main.rb notes.txt', 'bundle exec rake test'),
    },
  },
  {
    id: 'proj-php-wordstats',
    name: 'PHP · CLI with tests',
    language: 'php',
    description: 'A word-count class and a CLI, tested with PHPUnit through Composer, with CI',
    tests: 'vendor/bin/phpunit',
    filename: 'main.php',
    files: {
      'main.php': `<?php

require __DIR__ . '/src/WordStats.php';

$path = $argv[1] ?? 'sample.txt';
echo WordStats::format(WordStats::of(file_get_contents($path))), PHP_EOL;
`,
      'src/WordStats.php': `<?php

/** Lines, words and how often each word appears. */
final class WordStats
{
    /** @param array<string, int> $counts */
    public function __construct(public readonly int $lines, public readonly int $words, public readonly array $counts)
    {
    }

    public static function of(string $text): self
    {
        $lines = $text === '' ? 0 : count(explode("\\n", preg_replace('/\\n$/', '', $text)));
        preg_match_all("/[a-z0-9']+/", strtolower($text), $m);
        $counts = [];
        foreach ($m[0] as $word) {
            $counts[$word] = ($counts[$word] ?? 0) + 1;
        }
        return new self($lines, count($m[0]), $counts);
    }

    /**
     * The n most frequent words; ties in alphabetical order.
     * @param array<string, int> $counts
     * @return list<array{string, int}>
     */
    public static function top(array $counts, int $n): array
    {
        $entries = [];
        foreach ($counts as $word => $count) {
            $entries[] = [(string) $word, $count];
        }
        usort($entries, fn ($a, $b) => [$b[1], $a[0]] <=> [$a[1], $b[0]]);
        return array_slice($entries, 0, $n);
    }

    public static function format(self $s): string
    {
        $best = implode(', ', array_map(fn ($e) => "{$e[0]} {$e[1]}", self::top($s->counts, 3)));
        return "lines: {$s->lines}\\nwords: {$s->words}\\ntop: {$best}";
    }
}
`,
      'tests/WordStatsTest.php': `<?php

use PHPUnit\\Framework\\TestCase;

require_once __DIR__ . '/../src/WordStats.php';

final class WordStatsTest extends TestCase
{
    public function testCountsLinesAndWordsCaseInsensitively(): void
    {
        $s = WordStats::of("Hello, hello world!\\n");
        $this->assertSame([1, 3, 2], [$s->lines, $s->words, $s->counts['hello']]);
    }

    public function testTiesAreAlphabetical(): void
    {
        $this->assertSame([['a', 2], ['b', 2]], WordStats::top(['b' => 2, 'a' => 2, 'c' => 1], 2));
    }

    public function testEmptyText(): void
    {
        $s = WordStats::of('');
        $this->assertSame([0, 0], [$s->lines, $s->words]);
    }
}
`,
      'composer.json': `${JSON.stringify({ name: 'example/wordstats', description: 'Counts lines and words in a text file', type: 'project', license: 'MIT', require: { php: '>=8.1' }, 'require-dev': { 'phpunit/phpunit': '^11.5' } }, null, 2)}\n`,
      'phpunit.xml': `<?xml version="1.0" encoding="UTF-8"?>
<phpunit bootstrap="vendor/autoload.php" colors="true">
  <testsuites>
    <testsuite name="wordstats">
      <directory>tests</directory>
    </testsuite>
  </testsuites>
</phpunit>
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('PHP', 'php main.php notes.txt', 'composer install && vendor/bin/phpunit'),
    },
  },
  {
    id: 'proj-c-wordstats',
    name: 'C · CLI with tests',
    language: 'c',
    description: 'A word-count library and a CLI, built and tested with make, with CI',
    tests: 'make test',
    filename: 'main.c',
    files: {
      'main.c': `#include <stdio.h>
#include <stdlib.h>
#include "wordstats.h"

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "sample.txt";
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); return 1; }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    rewind(f);
    char *text = malloc((size_t)size + 1);
    size_t got = fread(text, 1, (size_t)size, f);
    text[got] = '\\0';
    fclose(f);

    Stats s = stats(text);
    char out[512];
    format_stats(&s, out, sizeof out);
    puts(out);
    stats_free(&s);
    free(text);
    return 0;
}
`,
      'wordstats.h': `#ifndef WORDSTATS_H
#define WORDSTATS_H
#include <stddef.h>

typedef struct { char *word; int count; } Entry;
typedef struct { int lines; int words; Entry *entries; size_t n; } Stats;

/* Lines, words and how often each word appears (entries sorted: most frequent first, ties alphabetical) */
Stats stats(const char *text);
int count_of(const Stats *s, const char *word);
void format_stats(const Stats *s, char *out, size_t size);
void stats_free(Stats *s);
#endif
`,
      'wordstats.c': `#include "wordstats.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int is_word_char(char c) { return isalnum((unsigned char)c) || c == '\\''; }

static int by_count_then_word(const void *a, const void *b) {
    const Entry *x = a, *y = b;
    if (x->count != y->count) return y->count - x->count;
    return strcmp(x->word, y->word);
}

Stats stats(const char *text) {
    Stats s = {0, 0, NULL, 0};
    size_t len = strlen(text);
    if (len > 0) {
        s.lines = 1;
        for (size_t i = 0; i < len; i++) if (text[i] == '\\n' && i + 1 < len) s.lines++;
    }
    size_t cap = 0;
    for (size_t i = 0; i < len;) {
        if (!is_word_char(text[i])) { i++; continue; }
        size_t start = i;
        while (i < len && is_word_char(text[i])) i++;
        char *w = malloc(i - start + 1);
        for (size_t k = 0; k < i - start; k++) w[k] = (char)tolower((unsigned char)text[start + k]);
        w[i - start] = '\\0';
        s.words++;
        size_t j = 0;
        while (j < s.n && strcmp(s.entries[j].word, w) != 0) j++;
        if (j < s.n) { s.entries[j].count++; free(w); continue; }
        if (s.n == cap) { cap = cap ? cap * 2 : 16; s.entries = realloc(s.entries, cap * sizeof(Entry)); }
        s.entries[s.n++] = (Entry){w, 1};
    }
    if (s.n) qsort(s.entries, s.n, sizeof(Entry), by_count_then_word);
    return s;
}

int count_of(const Stats *s, const char *word) {
    for (size_t i = 0; i < s->n; i++) if (strcmp(s->entries[i].word, word) == 0) return s->entries[i].count;
    return 0;
}

void format_stats(const Stats *s, char *out, size_t size) {
    int n = snprintf(out, size, "lines: %d\\nwords: %d\\ntop: ", s->lines, s->words);
    for (size_t i = 0; i < s->n && i < 3 && n > 0 && (size_t)n < size; i++)
        n += snprintf(out + n, size - (size_t)n, "%s%s %d", i ? ", " : "", s->entries[i].word, s->entries[i].count);
}

void stats_free(Stats *s) {
    for (size_t i = 0; i < s->n; i++) free(s->entries[i].word);
    free(s->entries);
    s->entries = NULL;
    s->n = 0;
}
`,
      'tests/test_wordstats.c': `#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../wordstats.h"

int main(void) {
    Stats s = stats("Hello, hello world!\\n");
    assert(s.lines == 1 && s.words == 3 && count_of(&s, "hello") == 2);
    stats_free(&s);

    s = stats("b a b a c");
    assert(strcmp(s.entries[0].word, "a") == 0 && s.entries[0].count == 2);
    assert(strcmp(s.entries[1].word, "b") == 0 && s.entries[1].count == 2);
    stats_free(&s);

    s = stats("");
    assert(s.lines == 0 && s.words == 0);
    stats_free(&s);

    puts("3 tests passed");
    return 0;
}
`,
      Makefile: `CFLAGS ?= -O1 -Wall -Wextra

wordstats: main.c wordstats.c wordstats.h
\t$(CC) $(CFLAGS) -o $@ main.c wordstats.c

test: tests/test_wordstats.c wordstats.c wordstats.h
\t$(CC) $(CFLAGS) -o test_wordstats tests/test_wordstats.c wordstats.c
\t./test_wordstats

.PHONY: test
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('C', 'make && ./wordstats notes.txt', 'make test'),
    },
  },
  {
    id: 'proj-cpp-wordstats',
    name: 'C++ · CLI with tests',
    language: 'cpp',
    description: 'A word-count library and a CLI, built with CMake and tested with CTest, with CI',
    tests: 'ctest',
    filename: 'main.cpp',
    files: {
      'main.cpp': `#include <fstream>
#include <iostream>
#include <sstream>
#include "wordstats.hpp"

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "sample.txt";
    std::ifstream file(path);
    if (!file) {
        std::cerr << path << ": cannot open\\n";
        return 1;
    }
    std::stringstream text;
    text << file.rdbuf();
    std::cout << wordstats::format(wordstats::stats(text.str())) << '\\n';
}
`,
      'wordstats.hpp': `#pragma once
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace wordstats {

struct Stats {
    int lines = 0;
    int words = 0;
    std::map<std::string, int> counts;
};

/// Lines, words and how often each word appears
Stats stats(const std::string &text);
/// The n most frequent words; ties in alphabetical order
std::vector<std::pair<std::string, int>> top(const std::map<std::string, int> &counts, std::size_t n);
std::string format(const Stats &s);

}  // namespace wordstats
`,
      'wordstats.cpp': `#include "wordstats.hpp"
#include <algorithm>
#include <cctype>

namespace wordstats {

static bool is_word_char(char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '\\''; }

Stats stats(const std::string &text) {
    Stats s;
    if (!text.empty()) {
        s.lines = 1;
        for (std::size_t i = 0; i + 1 < text.size(); ++i) if (text[i] == '\\n') ++s.lines;
    }
    std::string word;
    for (std::size_t i = 0; i <= text.size(); ++i) {
        if (i < text.size() && is_word_char(text[i])) {
            word += static_cast<char>(std::tolower(static_cast<unsigned char>(text[i])));
        } else if (!word.empty()) {
            ++s.counts[word];
            ++s.words;
            word.clear();
        }
    }
    return s;
}

std::vector<std::pair<std::string, int>> top(const std::map<std::string, int> &counts, std::size_t n) {
    std::vector<std::pair<std::string, int>> entries(counts.begin(), counts.end());
    std::stable_sort(entries.begin(), entries.end(), [](const auto &a, const auto &b) { return a.second > b.second; });
    if (entries.size() > n) entries.resize(n);
    return entries;
}

std::string format(const Stats &s) {
    std::string out = "lines: " + std::to_string(s.lines) + "\\nwords: " + std::to_string(s.words) + "\\ntop: ";
    bool first = true;
    for (const auto &[w, c] : top(s.counts, 3)) {
        out += (first ? "" : ", ") + w + " " + std::to_string(c);
        first = false;
    }
    return out;
}

}  // namespace wordstats
`,
      'tests/test_wordstats.cpp': `#include <iostream>
#include "../wordstats.hpp"

// Checks that stay on in Release builds (assert is compiled out there)
static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAILED: " #cond " (line " << __LINE__ << ")\\n"; ++failures; } } while (0)

int main() {
    auto s = wordstats::stats("Hello, hello world!\\n");
    CHECK(s.lines == 1 && s.words == 3 && s.counts["hello"] == 2);

    auto best = wordstats::top({{"b", 2}, {"a", 2}, {"c", 1}}, 2);
    CHECK(best.size() == 2 && best[0].first == "a" && best[1].first == "b");

    auto empty = wordstats::stats("");
    CHECK(empty.lines == 0 && empty.words == 0);

    if (failures) return 1;
    std::cout << "3 tests passed\\n";
}
`,
      'CMakeLists.txt': `cmake_minimum_required(VERSION 3.16)
project(wordstats CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(wordstats_lib wordstats.cpp)
add_executable(wordstats main.cpp)
target_link_libraries(wordstats wordstats_lib)

enable_testing()
add_executable(test_wordstats tests/test_wordstats.cpp)
target_link_libraries(test_wordstats wordstats_lib)
add_test(NAME wordstats COMMAND test_wordstats)
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('C++', 'cmake -B build && cmake --build build && ./build/wordstats notes.txt', 'ctest --test-dir build'),
    },
  },
];
