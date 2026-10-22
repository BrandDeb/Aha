/**
 * One small program per language: a greeting from the first argument, and a
 * short computation, so a new project runs straight away and shows how
 * arguments and output work in that language. Each prints the same two lines,
 * which also makes them easy to test.
 */

export interface LanguageStarter {
  id: string;
  name: string;
  language: string;
  description: string;
  /** Entry file */
  filename: string;
  code: string;
  files?: Record<string, string>;
}

/** The output every starter prints when run with no arguments */
export const STARTER_OUTPUT = ['Hello, World!', 'Primes up to 30: 2 3 5 7 11 13 17 19 23 29'];

export const LANGUAGE_STARTERS: LanguageStarter[] = [
  {
    id: 'lang-node',
    name: 'JavaScript (Node.js)',
    language: 'node',
    description: 'Plain Node.js with npm packages when you add a package.json',
    filename: 'main.js',
    code: `const name = process.argv[2] ?? 'World';
console.log(\`Hello, \${name}!\`);

const primes = [];
for (let n = 2; n <= 30; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
console.log('Primes up to 30:', primes.join(' '));
`,
    files: { 'package.json': '{\n  "name": "hello",\n  "private": true,\n  "version": "1.0.0"\n}\n' },
  },
  {
    id: 'lang-bun',
    name: 'TypeScript (Bun)',
    language: 'bun',
    description: 'Run TypeScript directly with Bun, npm packages included',
    filename: 'main.ts',
    code: `const name: string = Bun.argv[2] ?? 'World';
console.log(\`Hello, \${name}!\`);

const primes: number[] = [];
for (let n = 2; n <= 30; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
console.log('Primes up to 30:', primes.join(' '));
`,
    files: { 'bunfig.toml': '# Bun reads this file; its presence tells the studio to run this project with Bun\n' },
  },
  {
    id: 'lang-deno',
    name: 'TypeScript (Deno)',
    language: 'deno',
    description: 'Run TypeScript directly with Deno',
    filename: 'main.ts',
    code: `const name: string = Deno.args[0] ?? 'World';
console.log(\`Hello, \${name}!\`);

const primes: number[] = [];
for (let n = 2; n <= 30; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
console.log('Primes up to 30:', primes.join(' '));
`,
    files: { 'deno.json': '{\n  "tasks": { "start": "deno run -A main.ts" }\n}\n' },
  },
  {
    id: 'lang-go',
    name: 'Go',
    language: 'go',
    description: 'A Go module with the standard library',
    filename: 'main.go',
    code: `package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	name := "World"
	if len(os.Args) > 1 {
		name = os.Args[1]
	}
	fmt.Printf("Hello, %s!\\n", name)

	var primes []string
	for n := 2; n <= 30; n++ {
		isPrime := true
		for d := 2; d*d <= n; d++ {
			if n%d == 0 {
				isPrime = false
				break
			}
		}
		if isPrime {
			primes = append(primes, fmt.Sprint(n))
		}
	}
	fmt.Println("Primes up to 30:", strings.Join(primes, " "))
}
`,
    files: { 'go.mod': 'module example.com/hello\n\ngo 1.21\n' },
  },
  {
    id: 'lang-rust',
    name: 'Rust',
    language: 'rust',
    description: 'A Cargo project (first build downloads nothing; add crates to Cargo.toml)',
    filename: 'src/main.rs',
    code: `use std::env;

fn main() {
    let name = env::args().nth(1).unwrap_or_else(|| "World".to_string());
    println!("Hello, {}!", name);

    let primes: Vec<String> = (2..=30u32)
        .filter(|n| (2..*n).take_while(|d| d * d <= *n).all(|d| n % d != 0))
        .map(|n| n.to_string())
        .collect();
    println!("Primes up to 30: {}", primes.join(" "));
}
`,
    files: { 'Cargo.toml': '[package]\nname = "hello"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n' },
  },
  {
    id: 'lang-c',
    name: 'C',
    language: 'c',
    description: 'C, compiled with your compiler or the bundled zig',
    filename: 'main.c',
    code: `#include <stdio.h>

int main(int argc, char **argv) {
    printf("Hello, %s!\\n", argc > 1 ? argv[1] : "World");

    printf("Primes up to 30:");
    for (int n = 2; n <= 30; n++) {
        int prime = 1;
        for (int d = 2; d * d <= n; d++) if (n % d == 0) { prime = 0; break; }
        if (prime) printf(" %d", n);
    }
    printf("\\n");
    return 0;
}
`,
  },
  {
    id: 'lang-cpp',
    name: 'C++',
    language: 'cpp',
    description: 'C++17, compiled with your compiler or the bundled zig',
    filename: 'main.cpp',
    code: `#include <iostream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    std::string name = argc > 1 ? argv[1] : "World";
    std::cout << "Hello, " << name << "!\\n";

    std::vector<int> primes;
    for (int n = 2; n <= 30; n++) {
        bool prime = true;
        for (int d = 2; d * d <= n; d++) if (n % d == 0) { prime = false; break; }
        if (prime) primes.push_back(n);
    }
    std::cout << "Primes up to 30:";
    for (int p : primes) std::cout << ' ' << p;
    std::cout << '\\n';
}
`,
  },
  {
    id: 'lang-zig',
    name: 'Zig',
    language: 'zig',
    description: 'Zig, using the compiler bundled with the studio',
    filename: 'main.zig',
    code: `// Written for the Zig bundled with the studio (0.17); the standard library's API changes between Zig releases.
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const name = if (args.len > 1) args[1] else "World";
    std.debug.print("Hello, {s}!\\n", .{name});

    std.debug.print("Primes up to 30:", .{});
    var n: u32 = 2;
    while (n <= 30) : (n += 1) {
        var prime = true;
        var d: u32 = 2;
        while (d * d <= n) : (d += 1) {
            if (n % d == 0) {
                prime = false;
                break;
            }
        }
        if (prime) std.debug.print(" {d}", .{n});
    }
    std.debug.print("\\n", .{});
}
`,
  },
  {
    id: 'lang-java',
    name: 'Java',
    language: 'java',
    description: 'Java 11+ single-file programs run without a build step',
    filename: 'Main.java',
    code: `import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class Main {
    public static void main(String[] args) {
        String name = args.length > 0 ? args[0] : "World";
        System.out.println("Hello, " + name + "!");

        String primes = IntStream.rangeClosed(2, 30)
            .filter(n -> IntStream.rangeClosed(2, (int) Math.sqrt(n)).noneMatch(d -> n % d == 0))
            .mapToObj(Integer::toString)
            .collect(Collectors.joining(" "));
        System.out.println("Primes up to 30: " + primes);
    }
}
`,
  },
  {
    id: 'lang-kotlin',
    name: 'Kotlin',
    language: 'kotlin',
    description: 'Kotlin, compiled to a jar and run on the JVM',
    filename: 'main.kt',
    code: `fun main(args: Array<String>) {
    val name = args.firstOrNull() ?: "World"
    println("Hello, $name!")

    val primes = (2..30).filter { n -> (2..n).takeWhile { it * it <= n }.none { n % it == 0 } }
    println("Primes up to 30: " + primes.joinToString(" "))
}
`,
  },
  {
    id: 'lang-csharp',
    name: 'C#',
    language: 'csharp',
    description: '.NET console app',
    filename: 'Program.cs',
    code: `var name = args.Length > 0 ? args[0] : "World";
Console.WriteLine($"Hello, {name}!");

var primes = Enumerable.Range(2, 29).Where(n => Enumerable.Range(2, Math.Max(0, (int)Math.Sqrt(n) - 1)).All(d => n % d != 0));
Console.WriteLine("Primes up to 30: " + string.Join(" ", primes));
`,
    files: {
      'app.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`,
    },
  },
  {
    id: 'lang-ruby',
    name: 'Ruby',
    language: 'ruby',
    description: 'Ruby, with Bundler when you add a Gemfile',
    filename: 'main.rb',
    code: `name = ARGV[0] || "World"
puts "Hello, #{name}!"

primes = (2..30).select { |n| (2..Math.sqrt(n)).none? { |d| (n % d).zero? } }
puts "Primes up to 30: #{primes.join(' ')}"
`,
  },
  {
    id: 'lang-php',
    name: 'PHP',
    language: 'php',
    description: 'PHP command-line script',
    filename: 'main.php',
    code: `<?php
$name = $argv[1] ?? "World";
echo "Hello, $name!\\n";

$primes = array_filter(range(2, 30), function ($n) {
    for ($d = 2; $d * $d <= $n; $d++) if ($n % $d === 0) return false;
    return true;
});
echo "Primes up to 30: " . implode(" ", $primes) . "\\n";
`,
  },
  {
    id: 'lang-lua',
    name: 'Lua',
    language: 'lua',
    description: 'Lua 5.x script',
    filename: 'main.lua',
    code: `local name = arg[1] or "World"
print("Hello, " .. name .. "!")

local primes = {}
for n = 2, 30 do
  local prime = true
  for d = 2, math.floor(math.sqrt(n)) do
    if n % d == 0 then prime = false break end
  end
  if prime then primes[#primes + 1] = n end
end
print("Primes up to 30: " .. table.concat(primes, " "))
`,
  },
  {
    id: 'lang-perl',
    name: 'Perl',
    language: 'perl',
    description: 'Perl script',
    filename: 'main.pl',
    code: `use strict;
use warnings;

my $name = $ARGV[0] // "World";
print "Hello, $name!\\n";

my @primes = grep { my $n = $_; !grep { $n % $_ == 0 } 2 .. int(sqrt($n)) } 2 .. 30;
print "Primes up to 30: @primes\\n";
`,
  },
  {
    id: 'lang-r',
    name: 'R',
    language: 'r',
    description: 'R script, run with Rscript',
    filename: 'main.R',
    code: `args <- commandArgs(trailingOnly = TRUE)
name <- if (length(args) > 0) args[1] else "World"
cat("Hello, ", name, "!\\n", sep = "")

is_prime <- function(n) n > 1 && all(n %% seq_len(floor(sqrt(n)))[-1] != 0)
cat("Primes up to 30:", Filter(is_prime, 2:30), "\\n")
`,
  },
  {
    id: 'lang-julia',
    name: 'Julia',
    language: 'julia',
    description: 'Julia script',
    filename: 'main.jl',
    code: `name = length(ARGS) > 0 ? ARGS[1] : "World"
println("Hello, $(name)!")

isprime_(n) = n > 1 && all(n % d != 0 for d in 2:isqrt(n))
println("Primes up to 30: ", join(filter(isprime_, 2:30), " "))
`,
  },
  {
    id: 'lang-swift',
    name: 'Swift',
    language: 'swift',
    description: 'Swift script',
    filename: 'main.swift',
    code: `let name = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "World"
print("Hello, \\(name)!")

let primes = (2...30).filter { n in (2..<max(2, n)).prefix { $0 * $0 <= n }.allSatisfy { n % $0 != 0 } }
print("Primes up to 30: " + primes.map(String.init).joined(separator: " "))
`,
  },
  {
    id: 'lang-dart',
    name: 'Dart',
    language: 'dart',
    description: 'Dart command-line program',
    filename: 'main.dart',
    code: `import 'dart:math';

void main(List<String> args) {
  final name = args.isNotEmpty ? args[0] : 'World';
  print('Hello, $name!');

  final primes = [for (var n = 2; n <= 30; n++) if (List.generate(max(0, sqrt(n).floor() - 1), (i) => i + 2).every((d) => n % d != 0)) n];
  print('Primes up to 30: \${primes.join(' ')}');
}
`,
  },
  {
    id: 'lang-elixir',
    name: 'Elixir',
    language: 'elixir',
    description: 'Elixir script',
    filename: 'main.exs',
    code: `name = List.first(System.argv()) || "World"
IO.puts("Hello, #{name}!")

primes = for n <- 2..30, Enum.all?(2..max(2, trunc(:math.sqrt(n))), fn d -> d == n or rem(n, d) != 0 end), do: n
IO.puts("Primes up to 30: " <> Enum.join(primes, " "))
`,
  },
  {
    id: 'lang-haskell',
    name: 'Haskell',
    language: 'haskell',
    description: 'Haskell, run with runghc',
    filename: 'main.hs',
    code: `import System.Environment (getArgs)

main :: IO ()
main = do
  args <- getArgs
  let name = case args of
        (a:_) -> a
        [] -> "World"
  putStrLn ("Hello, " ++ name ++ "!")
  let primes = [n | n <- [2 .. 30], all (\\d -> n \`mod\` d /= 0) (takeWhile (\\d -> d * d <= n) [2 ..])]
  putStrLn ("Primes up to 30: " ++ unwords (map show primes))
`,
  },
  {
    id: 'lang-bash',
    name: 'Shell (Bash)',
    language: 'bash',
    description: 'Bash script',
    filename: 'main.sh',
    code: `#!/usr/bin/env bash
name="\${1:-World}"
echo "Hello, $name!"

primes=()
for ((n = 2; n <= 30; n++)); do
  prime=1
  for ((d = 2; d * d <= n; d++)); do
    if ((n % d == 0)); then prime=0; break; fi
  done
  ((prime)) && primes+=("$n")
done
echo "Primes up to 30: \${primes[*]}"
`,
  },
];
