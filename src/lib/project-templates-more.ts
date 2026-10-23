/**
 * More project templates: the same "wordstats" command-line tool as
 * project-templates.ts (library, program, unit tests, CI), for Bun, Deno, C#,
 * Kotlin, Swift, Zig, Dart and Elixir. Each was written and checked with the
 * language's own toolchain: it prints WORDSTATS_OUTPUT, its tests pass and its
 * formatter has nothing to change (npm run verify:templates runs them again).
 */

import { PROJECT_SAMPLE, projectReadme, type ProjectTemplate } from './project-templates.ts';

export const MORE_PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'proj-bun-wordstats',
    name: 'Bun · CLI with tests',
    language: 'bun',
    description: 'A word-count tool in TypeScript run by Bun, tested with bun:test, with CI',
    tests: 'bun test',
    filename: 'main.ts',
    files: {
      'main.ts': `import { format, stats } from "./wordstats";

const file = Bun.argv[2] ?? "sample.txt";
console.log(format(stats(await Bun.file(file).text())));
`,
      'bunfig.toml': `# Bun settings: https://bun.sh/docs/runtime/bunfig
[test]
coverage = false
`,
      'package.json': `{
  "name": "wordstats",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.14",
  "scripts": {
    "start": "bun run main.ts",
    "test": "bun test"
  }
}
`,
      'wordstats.test.ts': `import { expect, test } from "bun:test";
import { stats, top } from "./wordstats";

test("counts lines and words, case-insensitively", () => {
  const s = stats("Hello, hello world!\\n");
  expect(s.lines).toBe(1);
  expect(s.words).toBe(3);
  expect(s.counts.get("hello")).toBe(2);
});

test("ties are listed alphabetically", () => {
  expect(top(new Map([["b", 2], ["a", 2], ["c", 1]]), 2)).toEqual([["a", 2], ["b", 2]]);
});

test("empty text", () => {
  expect(stats("")).toEqual({ lines: 0, words: 0, counts: new Map() });
});
`,
      'wordstats.ts': `export interface Stats {
  lines: number;
  words: number;
  counts: Map<string, number>;
}

/** Lines, words and how often each word appears */
export function stats(text: string): Stats {
  const lines = text === "" ? 0 : text.replace(/\\n$/, "").split("\\n").length;
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return { lines, words: words.length, counts };
}

/** The n most frequent words; ties in alphabetical order */
export function top(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

export function format(s: Stats): string {
  const best = top(s.counts, 3).map(([w, c]) => \`\${w} \${c}\`).join(", ");
  return \`lines: \${s.lines}\\nwords: \${s.words}\\ntop: \${best}\`;
}
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `node_modules/
`,
      'README.md': projectReadme('Bun', 'bun main.ts notes.txt', 'bun test'),
    },
  },
  {
    id: 'proj-deno-wordstats',
    name: 'Deno · CLI with tests',
    language: 'deno',
    description: 'A word-count tool in TypeScript for Deno, tested with Deno.test and @std/assert, linted and formatted, with CI',
    tests: 'deno test',
    filename: 'main.ts',
    files: {
      'main.ts': `import { format, stats } from "./wordstats.ts";

const file = Deno.args[0] ?? "sample.txt";
console.log(format(stats(await Deno.readTextFile(file))));
`,
      'deno.json': `{
  "tasks": {
    "start": "deno run --allow-read main.ts",
    "test": "deno test"
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@^1.0.0"
  },
  "fmt": {
    "proseWrap": "preserve"
  }
}
`,
      'wordstats.ts': `export interface Stats {
  lines: number;
  words: number;
  counts: Map<string, number>;
}

/** Lines, words and how often each word appears */
export function stats(text: string): Stats {
  const lines = text === "" ? 0 : text.replace(/\\n$/, "").split("\\n").length;
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return { lines, words: words.length, counts };
}

/** The n most frequent words; ties in alphabetical order */
export function top(
  counts: Map<string, number>,
  n: number,
): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}

export function format(s: Stats): string {
  const best = top(s.counts, 3).map(([w, c]) => \`\${w} \${c}\`).join(", ");
  return \`lines: \${s.lines}\\nwords: \${s.words}\\ntop: \${best}\`;
}
`,
      'wordstats_test.ts': `import { assertEquals } from "@std/assert";
import { stats, top } from "./wordstats.ts";

Deno.test("counts lines and words, case-insensitively", () => {
  const s = stats("Hello, hello world!\\n");
  assertEquals([s.lines, s.words, s.counts.get("hello")], [1, 3, 2]);
});

Deno.test("ties are listed alphabetically", () => {
  assertEquals(top(new Map([["b", 2], ["a", 2], ["c", 1]]), 2), [["a", 2], [
    "b",
    2,
  ]]);
});

Deno.test("empty text", () => {
  assertEquals(stats(""), { lines: 0, words: 0, counts: new Map() });
});
`,
      'sample.txt': PROJECT_SAMPLE,
      'README.md': projectReadme('Deno', 'deno run --allow-read main.ts notes.txt', 'deno test --allow-read'),
    },
  },
  {
    id: 'proj-csharp-wordstats',
    name: 'C# · CLI with tests',
    language: 'csharp',
    description: 'A word-count tool on .NET 10 with a separate xUnit test project, format-checked, with CI',
    tests: 'dotnet test',
    filename: 'Program.cs',
    files: {
      'Program.cs': `using WordStats;

var file = args.Length > 0 ? args[0] : "sample.txt";
Console.WriteLine(Counter.Format(Counter.Count(File.ReadAllText(file))));
`,
      'WordStats.cs': `using System.Text.RegularExpressions;

namespace WordStats;

/// <summary>Lines, words and how often each word appears.</summary>
public record Stats(int Lines, int Words, Dictionary<string, int> Counts);

public static partial class Counter
{
    [GeneratedRegex("[a-z0-9']+")]
    private static partial Regex Word();

    public static Stats Count(string text)
    {
        var lines = text.Length == 0 ? 0 : text.TrimEnd('\\n').Split('\\n').Length;
        var words = Word().Matches(text.ToLowerInvariant()).Select(m => m.Value).ToList();
        var counts = words.GroupBy(w => w).ToDictionary(g => g.Key, g => g.Count());
        return new Stats(lines, words.Count, counts);
    }

    /// <summary>The n most frequent words; ties in alphabetical order.</summary>
    public static List<(string Word, int Count)> Top(Dictionary<string, int> counts, int n) =>
        counts.OrderByDescending(e => e.Value).ThenBy(e => e.Key, StringComparer.Ordinal).Take(n).Select(e => (e.Key, e.Value)).ToList();

    public static string Format(Stats s)
    {
        var best = string.Join(", ", Top(s.Counts, 3).Select(t => $"{t.Word} {t.Count}"));
        return $"lines: {s.Lines}\\nwords: {s.Words}\\ntop: {best}";
    }
}
`,
      'WordStats.csproj': `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="tests/**" />
  </ItemGroup>

</Project>
`,
      'tests/WordStats.Tests/CounterTests.cs': `using WordStats;
using Xunit;

public class CounterTests
{
    [Fact]
    public void CountsLinesAndWordsCaseInsensitively()
    {
        var s = Counter.Count("Hello, hello world!\\n");
        Assert.Equal((1, 3, 2), (s.Lines, s.Words, s.Counts["hello"]));
    }

    [Fact]
    public void TiesAreListedAlphabetically()
    {
        var best = Counter.Top(new() { ["b"] = 2, ["a"] = 2, ["c"] = 1 }, 2).Select(t => t.Word);
        Assert.Equal(["a", "b"], best);
    }

    [Fact]
    public void EmptyText()
    {
        var s = Counter.Count("");
        Assert.Equal((0, 0), (s.Lines, s.Words));
    }
}
`,
      'tests/WordStats.Tests/WordStats.Tests.csproj': `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../../WordStats.csproj" />
  </ItemGroup>

</Project>
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `bin/
obj/
`,
      'README.md': projectReadme('C#', 'dotnet run -- notes.txt', 'dotnet test tests/WordStats.Tests'),
    },
  },
  {
    id: 'proj-kotlin-wordstats',
    name: 'Kotlin · CLI with tests',
    language: 'kotlin',
    description: 'A word-count tool built with kotlinc alone (no Gradle), with a test program and CI',
    tests: 'kotlinc + java',
    filename: 'src/Main.kt',
    files: {
      'src/Main.kt': `import java.io.File

fun main(args: Array<String>) {
    val file = args.firstOrNull() ?: "sample.txt"
    println(format(count(File(file).readText())))
}
`,
      'src/WordStats.kt': `/** Lines, words and how often each word appears. */
data class Stats(val lines: Int, val words: Int, val counts: Map<String, Int>)

private val word = Regex("[a-z0-9']+")

fun count(text: String): Stats {
    val lines = if (text.isEmpty()) 0 else text.removeSuffix("\\n").split("\\n").size
    val words = word.findAll(text.lowercase()).map { it.value }.toList()
    return Stats(lines, words.size, words.groupingBy { it }.eachCount())
}

/** The n most frequent words; ties in alphabetical order. */
fun top(counts: Map<String, Int>, n: Int): List<Pair<String, Int>> =
    counts.entries.sortedWith(compareBy({ -it.value }, { it.key })).take(n).map { it.key to it.value }

fun format(s: Stats): String {
    val best = top(s.counts, 3).joinToString(", ") { (w, c) -> "$w $c" }
    return "lines: \${s.lines}\\nwords: \${s.words}\\ntop: $best"
}
`,
      'test/WordStatsTest.kt': `// Tests with nothing to install: each check names what it proves, and the run fails on the first one that doesn't hold.
fun check(name: String, condition: Boolean) {
    if (!condition) {
        System.err.println("FAIL: $name")
        kotlin.system.exitProcess(1)
    }
    println("ok - $name")
}

fun main() {
    val s = count("Hello, hello world!\\n")
    check("counts lines and words, case-insensitively", s.lines == 1 && s.words == 3 && s.counts["hello"] == 2)
    check("ties are listed alphabetically", top(mapOf("b" to 2, "a" to 2, "c" to 1), 2) == listOf("a" to 2, "b" to 2))
    check("empty text", count("") == Stats(0, 0, emptyMap()))
    println("3 tests passed")
}
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `build/
`,
      'README.md': projectReadme('Kotlin', 'kotlinc src -include-runtime -d build/app.jar && java -jar build/app.jar notes.txt', 'kotlinc src test -include-runtime -d build/test.jar && java -cp build/test.jar WordStatsTestKt'),
    },
  },
  {
    id: 'proj-swift-wordstats',
    name: 'Swift · package with tests',
    language: 'swift',
    description: 'A Swift package: a WordStats library, a command-line tool and XCTest tests, with CI',
    tests: 'swift test',
    filename: 'Sources/wordstats/main.swift',
    files: {
      'Sources/wordstats/main.swift': `import Foundation
import WordStats

let file = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "sample.txt"
do {
    print(format(count(try String(contentsOfFile: file, encoding: .utf8))))
} catch {
    FileHandle.standardError.write("Can't read \\(file): \\(error.localizedDescription)\\n".data(using: .utf8)!)
    exit(1)
}
`,
      'Package.swift': `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "wordstats",
    targets: [
        .target(name: "WordStats"),
        .executableTarget(name: "wordstats", dependencies: ["WordStats"]),
        .testTarget(name: "WordStatsTests", dependencies: ["WordStats"]),
    ]
)
`,
      'Sources/WordStats/WordStats.swift': `import Foundation

/// Lines, words and how often each word appears.
public struct Stats: Equatable {
    public let lines: Int
    public let words: Int
    public let counts: [String: Int]
}

public func count(_ text: String) -> Stats {
    let lines = text.isEmpty ? 0 : text.split(separator: "\\n", omittingEmptySubsequences: false).count - (text.hasSuffix("\\n") ? 1 : 0)
    let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789'")
    let words = text.lowercased().split { !allowed.contains($0) }.map(String.init)
    var counts: [String: Int] = [:]
    for word in words { counts[word, default: 0] += 1 }
    return Stats(lines: lines, words: words.count, counts: counts)
}

/// The n most frequent words; ties in alphabetical order.
public func top(_ counts: [String: Int], _ n: Int) -> [(String, Int)] {
    let sorted = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
    return sorted.prefix(n).map { ($0.key, $0.value) }
}

public func format(_ s: Stats) -> String {
    let best = top(s.counts, 3).map { "\\($0.0) \\($0.1)" }.joined(separator: ", ")
    return "lines: \\(s.lines)\\nwords: \\(s.words)\\ntop: \\(best)"
}
`,
      'Tests/WordStatsTests/WordStatsTests.swift': `import XCTest
@testable import WordStats

final class WordStatsTests: XCTestCase {
    func testCountsLinesAndWordsCaseInsensitively() {
        let s = count("Hello, hello world!\\n")
        XCTAssertEqual([s.lines, s.words, s.counts["hello"]], [1, 3, 2])
    }

    func testTiesAreListedAlphabetically() {
        XCTAssertEqual(top(["b": 2, "a": 2, "c": 1], 2).map { $0.0 }, ["a", "b"])
    }

    func testEmptyText() {
        XCTAssertEqual(count(""), Stats(lines: 0, words: 0, counts: [:]))
    }
}
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `.build/
Package.resolved
`,
      'README.md': projectReadme('Swift', 'swift run wordstats notes.txt', 'swift test'),
    },
  },
  {
    id: 'proj-zig-wordstats',
    name: 'Zig · CLI with tests',
    language: 'zig',
    description: 'A word-count tool for Zig 0.17 with test blocks next to the code, format-checked, with CI',
    tests: 'zig test',
    filename: 'src/main.zig',
    files: {
      'src/main.zig': `const std = @import("std");
const stats = @import("stats.zig");

pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;
    const io = init.io;

    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const file = if (args.len > 1) args[1] else "sample.txt";

    const text = try std.Io.Dir.cwd().readFileAlloc(io, file, gpa, .limited(1 << 24));
    defer gpa.free(text);

    var s = try stats.count(gpa, text);
    defer s.deinit(gpa);
    const best = try stats.top(gpa, s, 3);
    defer gpa.free(best);

    var buf: [4096]u8 = undefined;
    var w = std.Io.File.stdout().writer(io, &buf);
    const out = &w.interface;
    try out.print("lines: {d}\\nwords: {d}\\ntop: ", .{ s.lines, s.words });
    for (best, 0..) |e, i| try out.print("{s}{s} {d}", .{ if (i > 0) ", " else "", e.word, e.count });
    try out.print("\\n", .{});
    try out.flush();
}

test {
    _ = stats;
}
`,
      'src/stats.zig': `//! Lines, words and how often each word appears.
const std = @import("std");

pub const Entry = struct { word: []const u8, count: usize };

pub const Stats = struct {
    lines: usize,
    words: usize,
    counts: std.StringArrayHashMapUnmanaged(usize),

    pub fn deinit(self: *Stats, gpa: std.mem.Allocator) void {
        for (self.counts.keys()) |key| gpa.free(key);
        self.counts.deinit(gpa);
    }
};

fn isWordChar(c: u8) bool {
    return std.ascii.isAlphanumeric(c) or c == '\\'';
}

pub fn count(gpa: std.mem.Allocator, text: []const u8) !Stats {
    var stats: Stats = .{ .lines = 0, .words = 0, .counts = .empty };
    errdefer stats.deinit(gpa);
    if (text.len > 0) {
        const trimmed = std.mem.trimEnd(u8, text, "\\n");
        stats.lines = std.mem.count(u8, trimmed, "\\n") + 1;
    }
    var i: usize = 0;
    while (i < text.len) {
        while (i < text.len and !isWordChar(text[i])) i += 1;
        const start = i;
        while (i < text.len and isWordChar(text[i])) i += 1;
        if (i == start) continue;
        const word = try std.ascii.allocLowerString(gpa, text[start..i]);
        stats.words += 1;
        const slot = try stats.counts.getOrPut(gpa, word);
        if (slot.found_existing) {
            gpa.free(word);
            slot.value_ptr.* += 1;
        } else slot.value_ptr.* = 1;
    }
    return stats;
}

fn before(_: void, a: Entry, b: Entry) bool {
    if (a.count != b.count) return a.count > b.count;
    return std.mem.order(u8, a.word, b.word) == .lt;
}

/// The n most frequent words; ties in alphabetical order. The caller frees the slice.
pub fn top(gpa: std.mem.Allocator, stats: Stats, n: usize) ![]Entry {
    const entries = try gpa.alloc(Entry, stats.counts.count());
    for (stats.counts.keys(), stats.counts.values(), 0..) |word, c, i| entries[i] = .{ .word = word, .count = c };
    std.mem.sort(Entry, entries, {}, before);
    return gpa.realloc(entries, @min(n, entries.len));
}

test "counts lines and words, case-insensitively" {
    var s = try count(std.testing.allocator, "Hello, hello world!\\n");
    defer s.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), s.lines);
    try std.testing.expectEqual(@as(usize, 3), s.words);
    try std.testing.expectEqual(@as(usize, 2), s.counts.get("hello").?);
}

test "ties are listed alphabetically" {
    var s = try count(std.testing.allocator, "b a b a c");
    defer s.deinit(std.testing.allocator);
    const best = try top(std.testing.allocator, s, 2);
    defer std.testing.allocator.free(best);
    try std.testing.expectEqualStrings("a", best[0].word);
    try std.testing.expectEqualStrings("b", best[1].word);
}

test "empty text" {
    var s = try count(std.testing.allocator, "");
    defer s.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), s.lines);
    try std.testing.expectEqual(@as(usize, 0), s.words);
}
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `.zig-cache/
zig-out/
`,
      'README.md': projectReadme('Zig', 'zig run src/main.zig -- notes.txt', 'zig test src/main.zig'),
    },
  },
  {
    id: 'proj-dart-wordstats',
    name: 'Dart · CLI with tests',
    language: 'dart',
    description: 'A Dart package with a library, a command in bin/ and package:test tests, analyzed, with CI',
    tests: 'dart test',
    filename: 'bin/wordstats.dart',
    files: {
      'bin/wordstats.dart': `import 'dart:io';

import 'package:wordstats/wordstats.dart';

void main(List<String> args) {
  final file = args.isEmpty ? 'sample.txt' : args.first;
  print(format(count(File(file).readAsStringSync())));
}
`,
      'pubspec.yaml': `name: wordstats
description: Counts the lines and words of a text file and shows the most frequent words.
version: 1.0.0
publish_to: none

environment:
  sdk: ^3.5.0

dev_dependencies:
  test: ^1.25.0
`,
      'lib/wordstats.dart': `/// Lines, words and how often each word appears.
class Stats {
  final int lines;
  final int words;
  final Map<String, int> counts;

  const Stats(this.lines, this.words, this.counts);
}

final _word = RegExp(r"[a-z0-9']+");

Stats count(String text) {
  final lines = text.isEmpty ? 0 : text.replaceFirst(RegExp(r'\\n$'), '').split('\\n').length;
  final words = _word.allMatches(text.toLowerCase()).map((m) => m.group(0)!).toList();
  final counts = <String, int>{};
  for (final word in words) {
    counts[word] = (counts[word] ?? 0) + 1;
  }
  return Stats(lines, words.length, counts);
}

/// The n most frequent words; ties in alphabetical order.
List<MapEntry<String, int>> top(Map<String, int> counts, int n) {
  final entries = counts.entries.toList()
    ..sort((a, b) => b.value != a.value ? b.value - a.value : a.key.compareTo(b.key));
  return entries.take(n).toList();
}

String format(Stats s) {
  final best = top(s.counts, 3).map((e) => '\${e.key} \${e.value}').join(', ');
  return 'lines: \${s.lines}\\nwords: \${s.words}\\ntop: $best';
}
`,
      'test/wordstats_test.dart': `import 'package:test/test.dart';
import 'package:wordstats/wordstats.dart';

void main() {
  test('counts lines and words, case-insensitively', () {
    final s = count('Hello, hello world!\\n');
    expect([s.lines, s.words, s.counts['hello']], [1, 3, 2]);
  });

  test('ties are listed alphabetically', () {
    final best = top({'b': 2, 'a': 2, 'c': 1}, 2).map((e) => e.key);
    expect(best, ['a', 'b']);
  });

  test('empty text', () {
    final s = count('');
    expect([s.lines, s.words], [0, 0]);
  });
}
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `.dart_tool/
pubspec.lock
`,
      'README.md': projectReadme('Dart', 'dart run bin/wordstats.dart notes.txt', 'dart test'),
    },
  },
  {
    id: 'proj-elixir-wordstats',
    name: 'Elixir · Mix project with tests',
    language: 'elixir',
    description: 'A Mix project with a WordStats module, ExUnit tests and a run script, format-checked, with CI',
    tests: 'mix test',
    filename: 'main.exs',
    files: {
      'main.exs': `file = List.first(System.argv(), "sample.txt")
file |> File.read!() |> WordStats.count() |> WordStats.format() |> IO.puts()
`,
      '.formatter.exs': `[
  inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}", "main.exs"]
]
`,
      'mix.exs': `defmodule WordStats.MixProject do
  use Mix.Project

  def project do
    [app: :wordstats, version: "0.1.0", elixir: "~> 1.15", deps: []]
  end

  def application do
    [extra_applications: [:logger]]
  end
end
`,
      'lib/wordstats.ex': `defmodule WordStats do
  @moduledoc "Lines, words and how often each word appears."

  def count(text) do
    lines =
      if text == "",
        do: 0,
        else: text |> String.trim_trailing("\\n") |> String.split("\\n") |> length()

    words = Regex.scan(~r/[a-z0-9']+/, String.downcase(text)) |> List.flatten()
    %{lines: lines, words: length(words), counts: Enum.frequencies(words)}
  end

  @doc "The n most frequent words; ties in alphabetical order."
  def top(counts, n) do
    counts |> Enum.sort_by(fn {word, count} -> {-count, word} end) |> Enum.take(n)
  end

  def format(stats) do
    best =
      stats.counts |> top(3) |> Enum.map_join(", ", fn {word, count} -> "#{word} #{count}" end)

    "lines: #{stats.lines}\\nwords: #{stats.words}\\ntop: #{best}"
  end
end
`,
      'test/test_helper.exs': `ExUnit.start()
`,
      'test/wordstats_test.exs': `defmodule WordStatsTest do
  use ExUnit.Case

  test "counts lines and words, case-insensitively" do
    stats = WordStats.count("Hello, hello world!\\n")
    assert {stats.lines, stats.words, stats.counts["hello"]} == {1, 3, 2}
  end

  test "ties are listed alphabetically" do
    assert WordStats.top(%{"b" => 2, "a" => 2, "c" => 1}, 2) == [{"a", 2}, {"b", 2}]
  end

  test "empty text" do
    assert WordStats.count("") == %{lines: 0, words: 0, counts: %{}}
  end
end
`,
      'sample.txt': PROJECT_SAMPLE,
      '.gitignore': `_build/
deps/
`,
      'README.md': projectReadme('Elixir', 'mix run main.exs notes.txt', 'mix test'),
    },
  },
];
