/** Errors and the recovery screen. */
export const errorsEn = {
  'crash.title': 'Something went wrong',
  'crash.body': 'Pigmento’s window ran into a problem it couldn’t recover from. Your picture is still here: save a copy, or reload the window (a recovery copy is kept and offered back).',
  'crash.save': 'Save a copy…',
  'crash.reload': 'Reload the window',
  'crash.details': 'What happened',
  'error.unexpected': 'Something went wrong, but your picture is safe. Saving a copy now is a good idea.',
  'error.internal': 'Something went wrong inside Pigmento. Your picture is safe; if anything looks wrong, save a copy and restart.',
  'error.notEnoughMemory': 'A {w} × {h} picture needs about {need} GB of memory, but only {free} GB is free. Close other apps, or choose a smaller size.',
} as const;
