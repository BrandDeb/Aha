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
  /** What a run prints when it works, if not STARTER_OUTPUT (smart contracts build and test instead) */
  expect?: string[];
  /** False when the program takes no command-line arguments (Gleam without packages, Cairo) */
  takesArgs?: boolean;
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
    <!-- Run on the newest .NET installed, even when it is a newer major version than this targets -->
    <RollForward>LatestMajor</RollForward>
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
  {
    id: 'lang-scala',
    name: 'Scala',
    language: 'scala',
    description: 'Scala 3, run with scala-cli',
    filename: 'main.scala',
    code: `@main def hello(args: String*): Unit =
  val name = args.headOption.getOrElse("World")
  println(s"Hello, $name!")
  val primes = (2 to 30).filter(n => (2 until n).forall(n % _ != 0))
  println(s"Primes up to 30: \${primes.mkString(" ")}")
`,
  },
  {
    id: 'lang-clojure',
    name: 'Clojure',
    language: 'clojure',
    description: 'Clojure on the JVM, run with the Clojure CLI',
    filename: 'main.clj',
    code: `(require '[clojure.string :as str])

(let [name (or (first *command-line-args*) "World")
      prime? (fn [n] (not-any? #(zero? (mod n %)) (range 2 n)))]
  (println (str "Hello, " name "!"))
  (println (str "Primes up to 30: " (str/join " " (filter prime? (range 2 31))))))
`,
  },
  {
    id: 'lang-groovy',
    name: 'Groovy',
    language: 'groovy',
    description: 'Groovy script on the JVM',
    filename: 'main.groovy',
    code: `def name = args ? args[0] : 'World'
println "Hello, \${name}!"
def primes = (2..30).findAll { n -> (2..<n).every { n % it != 0 } }
println "Primes up to 30: \${primes.join(' ')}"
`,
  },
  {
    id: 'lang-fsharp',
    name: 'F#',
    language: 'fsharp',
    description: 'F# script, run with dotnet fsi',
    filename: 'main.fsx',
    code: `let args = fsi.CommandLineArgs |> Array.skip 1
let name = if args.Length > 0 then args.[0] else "World"
printfn "Hello, %s!" name

let isPrime n = [ 2 .. n - 1 ] |> List.forall (fun d -> n % d <> 0)
let primes = [ 2 .. 30 ] |> List.filter isPrime |> List.map string
printfn "Primes up to 30: %s" (String.concat " " primes)
`,
  },
  {
    id: 'lang-gleam',
    name: 'Gleam',
    language: 'gleam',
    description: 'Gleam on the JavaScript target',
    filename: 'src/hello.gleam',
    code: `import gleam/int
import gleam/io
import gleam/list
import gleam/string

pub fn main() {
  io.println("Hello, World!")
  let primes = primes_from(2, [])
  io.println("Primes up to 30: " <> string.join(list.map(primes, int.to_string), " "))
}

fn primes_from(n: Int, found: List(Int)) -> List(Int) {
  case n > 30 {
    True -> list.reverse(found)
    False ->
      case is_prime(n, 2) {
        True -> primes_from(n + 1, [n, ..found])
        False -> primes_from(n + 1, found)
      }
  }
}

fn is_prime(n: Int, d: Int) -> Bool {
  case d * d > n {
    True -> True
    False ->
      case n % d {
        0 -> False
        _ -> is_prime(n, d + 1)
      }
  }
}
`,
    files: {
      'gleam.toml': 'name = "hello"\nversion = "1.0.0"\ntarget = "javascript"\n\n[dependencies]\ngleam_stdlib = ">= 0.44.0 and < 2.0.0"\n',
    },
    takesArgs: false,
  },
  {
    id: 'lang-nim',
    name: 'Nim',
    language: 'nim',
    description: 'Nim, compiled through C and run',
    filename: 'main.nim',
    code: `import std/[os, sequtils, strutils]

let name = if paramCount() > 0: paramStr(1) else: "World"
echo "Hello, ", name, "!"

proc isPrime(n: int): bool =
  for d in 2 ..< n:
    if n mod d == 0: return false
  true

echo "Primes up to 30: ", toSeq(2 .. 30).filterIt(isPrime(it)).mapIt($it).join(" ")
`,
  },
  {
    id: 'lang-crystal',
    name: 'Crystal',
    language: 'crystal',
    description: 'Crystal: Ruby-like syntax, compiled to native code',
    filename: 'main.cr',
    code: `name = ARGV.first? || "World"
puts "Hello, #{name}!"

primes = (2..30).select { |n| (2...n).all? { |d| n % d != 0 } }
puts "Primes up to 30: #{primes.join(" ")}"
`,
  },
  {
    id: 'lang-odin',
    name: 'Odin',
    language: 'odin',
    description: 'Odin, compiled to a native executable',
    filename: 'main.odin',
    code: `package main

import "core:fmt"
import "core:os"

main :: proc() {
	name := len(os.args) > 1 ? os.args[1] : "World"
	fmt.printf("Hello, %s!\\n", name)
	fmt.print("Primes up to 30:")
	for n in 2 ..= 30 {
		prime := true
		for d := 2; d * d <= n; d += 1 {
			if n % d == 0 {
				prime = false
				break
			}
		}
		if prime {
			fmt.printf(" %d", n)
		}
	}
	fmt.println()
}
`,
  },
  {
    id: 'lang-racket',
    name: 'Racket',
    language: 'racket',
    description: 'Racket, a modern Lisp',
    filename: 'main.rkt',
    code: `#lang racket/base
(require racket/list racket/string)

(define args (current-command-line-arguments))
(define name (if (> (vector-length args) 0) (vector-ref args 0) "World"))
(printf "Hello, ~a!\\n" name)

(define (prime? n) (for/and ([d (in-range 2 n)]) (not (zero? (modulo n d)))))
(printf "Primes up to 30: ~a\\n" (string-join (map number->string (filter prime? (range 2 31))) " "))
`,
  },
  {
    id: 'lang-d',
    name: 'D',
    language: 'd',
    description: 'D, compiled with LDC',
    filename: 'main.d',
    code: `import std.stdio, std.algorithm, std.range, std.conv, std.array;

void main(string[] args)
{
    auto name = args.length > 1 ? args[1] : "World";
    writeln("Hello, ", name, "!");
    auto primes = iota(2, 31).filter!(n => iota(2, n).all!(d => n % d != 0)).map!(to!string).join(" ");
    writeln("Primes up to 30: ", primes);
}
`,
  },
  {
    id: 'lang-erlang',
    name: 'Erlang',
    language: 'erlang',
    description: 'Erlang, run as an escript',
    filename: 'main.erl',
    code: `#!/usr/bin/env escript
-module(main).
-export([main/1]).

main(Args) ->
    Name = case Args of
        [First | _] -> First;
        [] -> "World"
    end,
    io:format("Hello, ~s!~n", [Name]),
    Primes = [N || N <- lists:seq(2, 30), lists:all(fun(D) -> N rem D =/= 0 end, lists:seq(2, N - 1))],
    io:format("Primes up to 30: ~s~n", [lists:join(" ", [integer_to_list(P) || P <- Primes])]).
`,
  },
  {
    id: 'lang-ocaml',
    name: 'OCaml',
    language: 'ocaml',
    description: 'OCaml script',
    filename: 'main.ml',
    code: `let () =
  let name = if Array.length Sys.argv > 1 then Sys.argv.(1) else "World" in
  Printf.printf "Hello, %s!\\n" name;
  let is_prime n =
    let rec go d = d * d > n || (n mod d <> 0 && go (d + 1)) in
    go 2
  in
  let primes = List.filter is_prime (List.init 29 (fun i -> i + 2)) in
  Printf.printf "Primes up to 30: %s\\n" (String.concat " " (List.map string_of_int primes))
`,
  },
  {
    id: 'lang-fortran',
    name: 'Fortran',
    language: 'fortran',
    description: 'Modern Fortran, compiled with gfortran',
    filename: 'main.f90',
    code: `program main
  implicit none
  character(len=100) :: name
  character(len=200) :: line
  character(len=8) :: buf
  integer :: n, d
  logical :: prime

  if (command_argument_count() > 0) then
    call get_command_argument(1, name)
  else
    name = 'World'
  end if
  print '(a)', 'Hello, ' // trim(name) // '!'

  line = 'Primes up to 30:'
  do n = 2, 30
    prime = .true.
    do d = 2, n - 1
      if (mod(n, d) == 0) then
        prime = .false.
        exit
      end if
    end do
    if (prime) then
      write (buf, '(i0)') n
      line = trim(line) // ' ' // trim(buf)
    end if
  end do
  print '(a)', trim(line)
end program main
`,
  },
  {
    id: 'lang-cairo',
    name: 'Cairo (Starknet)',
    language: 'cairo',
    description: 'Cairo, the language of Starknet, built and run with Scarb',
    filename: 'src/lib.cairo',
    code: `#[executable]
fn main() {
    println!("Hello, World!");
    let mut line: ByteArray = "Primes up to 30:";
    let mut n: u32 = 2;
    while n <= 30 {
        let mut d: u32 = 2;
        let mut prime = true;
        while d * d <= n {
            if n % d == 0 {
                prime = false;
                break;
            }
            d += 1;
        };
        if prime {
            line += format!(" {}", n);
        }
        n += 1;
    };
    println!("{}", line);
}
`,
    files: {
      'Scarb.toml': '[package]\nname = "hello"\nversion = "0.1.0"\nedition = "2024_07"\n\n[cairo]\nenable-gas = false\n\n[dependencies]\ncairo_execute = "*"\n\n[executable]\n',
    },
    takesArgs: false,
  },
  {
    id: 'lang-solidity',
    name: 'Solidity (Foundry)',
    language: 'solidity',
    description: 'An Ethereum smart contract with unit and fuzz tests, built and tested with Foundry',
    filename: 'src/Counter.sol',
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }
}
`,
    files: {
      'foundry.toml': '[profile.default]\nsrc = "src"\nout = "out"\nlibs = ["lib"]\ntest = "test"\n',
      'test/Counter.t.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Counter} from "../src/Counter.sol";

contract CounterTest {
    Counter counter;

    function setUp() public {
        counter = new Counter();
        counter.setNumber(0);
    }

    function test_Increment() public {
        counter.increment();
        require(counter.number() == 1, "expected 1");
    }

    /// Foundry calls this with 256 random values
    function testFuzz_SetNumber(uint256 x) public {
        counter.setNumber(x);
        require(counter.number() == x, "number mismatch");
    }
}
`,
    },
    expect: ['[PASS] test_Increment()', '2 passed; 0 failed'],
  },
  {
    id: 'lang-vyper',
    name: 'Vyper',
    language: 'vyper',
    description: 'A Pythonic Ethereum contract, compiled to its ABI and bytecode',
    filename: 'contract.vy',
    code: `# pragma version ^0.4.0
greeting: public(String[100])


@deploy
def __init__():
    self.greeting = "Hello, World!"


@external
@view
def add(a: uint256, b: uint256) -> uint256:
    return a + b
`,
    expect: ['"name": "greeting"', '0x'],
  },
  {
    id: 'lang-move',
    name: 'Move (Sui)',
    language: 'move',
    description: 'A Sui Move package with a unit test, built and tested with the Sui CLI',
    filename: 'sources/greeting.move',
    code: `module hello::greeting;

use std::string::{Self, String};

public fun greet(name: vector<u8>): String {
    let mut s = string::utf8(b"Hello, ");
    s.append(string::utf8(name));
    s.append(string::utf8(b"!"));
    s
}

#[test]
fun test_greet() {
    assert!(greet(b"World") == string::utf8(b"Hello, World!"), 0);
}
`,
    files: { 'Move.toml': '[package]\nname = "hello"\nedition = "2024"\n\n[addresses]\nhello = "0x0"\n' },
    expect: ['test_greet', 'Test result: OK'],
  },
];
