/**
 * Live values for Python: a sys.settrace tracer that runs the entry file as
 * __main__ and records, for the project's own files, how often each line ran
 * and which variables it changed (compared by their repr before and after the
 * line), plus what each function returned. It writes the same JSON shape as
 * the JavaScript runtime.
 */

export const PY_TRACER = String.raw`import ast, atexit, builtins, json, os, reprlib, runpy, sys, types

ROOT = os.getcwd()
OUT = os.environ["AHA_LIVE_OUT"]
MAX_EVENTS = 300000
r = reprlib.Repr()
r.maxstring, r.maxother, r.maxlist, r.maxtuple, r.maxdict, r.maxset, r.maxlevel = 60, 60, 6, 6, 5, 6, 2
data = {}
state = {"events": 0, "truncated": False}
SKIP_TYPES = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type)


def short(v):
    try:
        s = r.repr(v)
    except Exception:
        s = "‹unreadable›"
    return s if len(s) <= 72 else s[:71] + "…"


def rel(filename):
    try:
        p = os.path.relpath(os.path.abspath(filename), ROOT)
    except ValueError:
        return None
    parts = p.split(os.sep)
    if p.startswith("..") or ".venv" in parts or "site-packages" in parts or parts[0] == ".aha-live":
        return None
    return p.replace(os.sep, "/")


def entry(path, line):
    key = "%s:%d" % (path, line)
    e = data.get(key)
    if e is None:
        e = data[key] = {"hits": 0, "values": {}}
        entry_at[id(e)] = (path, line)
    return e


entry_at = {}


def record(e, name, s):
    at = entry_at.get(id(e))
    if at is not None:
        step_value(at[0], at[1], name, s)
    x = e["values"].get(name)
    if x is None:
        x = e["values"][name] = {"n": 0, "first": [], "last": s}
    x["n"] += 1
    if len(x["first"]) < 8:
        x["first"].append(s)
    x["last"] = s


def snap(frame):
    out = {}
    for k, v in list(frame.f_locals.items()):
        if k.startswith("__") or isinstance(v, SKIP_TYPES):
            continue
        out[k] = short(v)
    return out


def statement_lines():
    files = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".venv", "node_modules", ".aha-live", "__pycache__", ".git")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                tree = ast.parse(open(path, encoding="utf-8").read())
            except Exception:
                continue
            lines = sorted({n.lineno for n in ast.walk(tree) if isinstance(n, ast.stmt)})
            files[os.path.relpath(path, ROOT).replace(os.sep, "/")] = lines
    return files


def dump():
    try:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"truncated": state["truncated"], "files": statement_lines(), "data": data, "steps": steps}, f)
    except Exception:
        pass


snapshots = {}
raising = set()
# Rewind: every line that ran, in order, with what it set (capped)
MAX_STEPS = 20000
steps = []


def step_value(path, line, name, s):
    for i in range(len(steps) - 1, max(-1, len(steps) - 201), -1):
        if steps[i][0] == path and steps[i][1] == line:
            if steps[i][2] is None:
                steps[i][2] = {}
            steps[i][2][name] = s
            return


def tracer(frame, event, arg):
    path = rel(frame.f_code.co_filename)
    if path is None:
        return None
    if event in ("line", "return"):
        prev = snapshots.get(id(frame))
        if prev is not None:
            pline, before = prev
            now = snap(frame)
            changed = [k for k, v in now.items() if before.get(k) != v]
            if changed:
                e = entry(path, pline)
                for k in changed:
                    record(e, k, now[k])
        if event == "line":
            raising.discard(id(frame))
            state["events"] += 1
            if state["events"] > MAX_EVENTS and not state["truncated"]:
                state["truncated"] = True
                sys.settrace(None)
                dump()
                print("\n[live values: the program ran too long; showing the start of the run]", flush=True)
                os._exit(124)
            entry(path, frame.f_lineno)["hits"] += 1
            if len(steps) < MAX_STEPS:
                steps.append([path, frame.f_lineno, None])
            snapshots[id(frame)] = (frame.f_lineno, snap(frame))
        else:
            # a function leaving because of an error returns nothing; the module itself returns nothing to show
            if id(frame) not in raising and frame.f_code.co_name != "<module>":
                record(entry(path, frame.f_lineno), "return", short(arg))
            raising.discard(id(frame))
            snapshots.pop(id(frame), None)
    elif event == "exception":
        raising.add(id(frame))
        if arg[2] is not None and arg[2].tb_next is None:
            # where it was raised (not each frame it passes through)
            record(entry(path, frame.f_lineno), "threw", ("%s: %s" % (arg[0].__name__, arg[1]))[:72])
    return tracer


_print = builtins.print


def live_print(*a, **k):
    # what the program printed, on the line that printed it
    try:
        f = sys._getframe(1)
        p = rel(f.f_code.co_filename)
        if p is not None and k.get("file") in (None, sys.stdout, sys.stderr):
            text = (k.get("sep") or " ").join(str(x) for x in a).replace("\n", " ⏎ ")
            record(entry(p, f.f_lineno), "out", text if len(text) <= 72 else text[:71] + "…")
    except Exception:
        pass
    return _print(*a, **k)


builtins.print = live_print
atexit.register(dump)
target = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
sys.settrace(tracer)
try:
    runpy.run_path(target, run_name="__main__")
finally:
    sys.settrace(None)
`;
