# I18n Package

This package provides a set of tools to help you internationalize your Chrome Extension.

https://developer.chrome.com/docs/extensions/reference/api/i18n

## Setup

The extension imports this module through the `@extension/i18n` alias defined in `wxt.config.ts`. No install step is needed.

## Manage translations

You can manage translations in the `public/_locales` directory. WXT copies it into the build as `_locales`.

`public/_locales/en/messages.json`

```json
{
  "helloWorld": {
    "message": "Hello, World!"
  }
}
```

`public/_locales/ko/messages.json`

```json
{
  "helloWorld": {
    "message": "안녕하세요, 여러분!"
  }
}
```

## Delete or Add a new language

When you want to delete or add a new language, you don't need to edit `lib/type.ts`.
That's because `generate-i18n.mjs` generates it automatically. It runs on `pnpm install`, `pnpm type-check`, `pnpm build`, and when a locale file changes during `pnpm dev`.

Following the steps below to delete or add a new language.

### Delete a language

If you want to delete unused languages, you can delete the corresponding directory in the `public/_locales` directory.

```
public/_locales
├── en
│   └── messages.json
└── ko // delete this directory
    └── messages.json 
```

Then run the following command (or just run `pnpm dev` or `pnpm build`).

```bash
node src/i18n/generate-i18n.mjs
```

### Add a new language

If you want to add a new language, you can create a new directory in the `public/_locales` directory.

```
public/_locales
├── en
│   └── messages.json
├── ko
│   └── messages.json
└── ja // create this directory
    └── messages.json // and create this file 
```

Then same as above, run the following command (or just run `pnpm dev` or `pnpm build`).

```bash
node src/i18n/generate-i18n.mjs
```


## Usage

### Translation function

Just import the `t` function and use it to translate the key.

```typescript
import { t } from '@extension/i18n';

console.log(t('ui_loading')); // Loading...
```

```typescript jsx
import { t } from '@extension/i18n';

const Component = () => {
  return (
    <button>
      {t('navigation_toggleTheme')} // Toggle Theme
    </button>
  );
};
```

### Placeholders

If you want to use placeholders, you can use the following format.

> For more information, see the [Message Placeholders](https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats#placeholders) section.

`public/_locales/en/messages.json`

```json
{
  "greeting": {
    "description": "Greeting message",
    "message": "Hello, My name is $NAME$",
    "placeholders": {
      "name": {
        "content": "$1",
        "example": "John Doe"
      }
    }
  },
  "hello": {
    "description": "Placeholder example",
    "message": "Hello $1"
  }
}
```

`public/_locales/ko/messages.json`

```json
{
  "greeting": {
    "description": "인사 메시지",
    "message": "안녕하세요, 제 이름은 $NAME$입니다.",
    "placeholders": {
      "name": {
        "content": "$1",
        "example": "서종학"
      }
    }
  },
  "hello": {
    "description": "Placeholder 예시",
    "message": "안녕 $1"
  }
}
```

If you want to replace the placeholder, you can pass the value as the second argument.

Function `t` has exactly the same interface as the `chrome.i18n.getMessage` function.

```typescript
import { t } from '@extension/i18n';

console.log(t('greeting', 'John Doe')); // Hello, My name is John Doe
console.log(t('greeting', ['John Doe'])); // Hello, My name is John Doe

console.log(t('hello')); // Hello
console.log(t('hello', 'World')); // Hello World
console.log(t('hello', ['World'])); // Hello World
```

### Locale in development

`t` calls `chrome.i18n.getMessage` in both `pnpm dev` and production builds, so it uses the browser's UI language.
To see another language, change the browser language; Chrome falls back to `default_locale` (`en`) for missing messages.

### Type Safety

When you forget to add a key to all language's `messages.json` files, you will get a Typescript error.

`public/_locales/en/messages.json`

```json
{
  "hello": {
    "message": "Hello World!"
  }
}
```

`public/_locales/ko/messages.json`

```json
{
  "helloWorld": {
    "message": "안녕하세요, 여러분!"
  }
}
```

```typescript
import { t } from '@extension/i18n';

// Error: TS2345: Argument of type "hello" is not assignable to parameter of type
console.log(t('hello'));
```
