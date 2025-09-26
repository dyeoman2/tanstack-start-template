run this command in the terminal:
```bash
for port in {3000..3009}; do lsof -ti tcp:$port | xargs -r kill; done
```
