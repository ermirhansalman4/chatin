import re

with open('app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and remove orphan lines 1014-1026 area
# The orphan block starts right after the clean closing }; of sendMessage
# Pattern: };  }\n};\n uccess");  ...

# We'll find the exact position using a regex
pattern = r'\};\n  \}\n\};\n uccess"\);\n        \} else \{\n            await updateDoc\(userRef, \{ xp: newXP \}\);\n        \}\n    \}\n\n    // --- BOT COMMANDS ---\n    if \(content\.startsWith\(\'\/\'\)\) \{\n        handleBotCommand\(content, currentChannelId, user\);\n    \}\n\};\n'

replacement = '};\n'

new_content, count = re.subn(pattern, replacement, content)

if count > 0:
    with open('app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'FIXED - replaced {count} occurrence(s)')
else:
    # Try to find what's around uccess
    idx = content.find('uccess")')
    if idx != -1:
        print('Pattern not found. Context around uccess:')
        print(repr(content[idx-50:idx+200]))
    else:
        print('uccess not found at all - file may already be clean')
