BIN    := gusteau
PREFIX := $(HOME)/.local/bin

.PHONY: all build install update clean

all: build install

build:
	bun install --frozen-lockfile
	bun run build

install:
	mkdir -p $(PREFIX)
	install -m 755 dist/$(BIN) $(PREFIX)/$(BIN)
	@echo "installed $(PREFIX)/$(BIN)"

update: clean
	rm -f $(PREFIX)/$(BIN)
	$(MAKE) build install

clean:
	rm -rf dist
