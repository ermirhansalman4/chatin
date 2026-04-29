
const fs = require('fs');

const content = fs.readFileSync('app.js', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        let char = line[j];
        if (char === '{' || char === '[' || char === '(') {
            stack.push({ char, line: i + 1, col: j + 1 });
        } else if (char === '}' || char === ']' || char === ')') {
            if (stack.length === 0) {
                console.log(`Unmatched closing ${char} at line ${i + 1}, col ${j + 1}`);
            } else {
                let last = stack.pop();
                if ((char === '}' && last.char !== '{') ||
                    (char === ']' && last.char !== '[') ||
                    (char === ')' && last.char !== '(')) {
                    console.log(`Mismatch: ${last.char} at line ${last.line} closed by ${char} at line ${i + 1}`);
                }
            }
        }
    }
}

if (stack.length > 0) {
    console.log("Unclosed items:");
    stack.forEach(item => {
        console.log(`${item.char} at line ${item.line}, col ${item.col}`);
    });
} else {
    console.log("All braces, brackets, and parentheses are balanced.");
}
