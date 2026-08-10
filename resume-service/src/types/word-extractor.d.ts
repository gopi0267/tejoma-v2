// word-extractor ships no type declarations. The monolith tolerates this implicitly (its own
// tsconfig.json has no "strict": true, so an implicit `any` from a missing declaration file isn't
// an error there); this service's tsconfig does have strict mode, so a minimal ambient module
// declaration is the correct, standard fix for an untyped JS dependency - not a workaround.
declare module 'word-extractor';
