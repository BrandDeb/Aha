# Starts an embedded PostgreSQL for tests: prints its URI and READY, then waits to be killed.
import pathlib, sys, time
import pgserver

db = pgserver.get_server(pathlib.Path(sys.argv[1]), cleanup_mode='stop')
print(db.get_uri(), flush=True)
db.psql("CREATE TABLE widgets (id serial primary key, name text not null, price numeric); INSERT INTO widgets(name, price) VALUES ('bolt', 0.25), ('nut', 0.1), ('gear', 12.5);")
print('READY', flush=True)
time.sleep(600)
