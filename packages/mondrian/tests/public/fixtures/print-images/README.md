# Print image fixtures

`CGATS21_CRPC6.icc` is the unmodified CMYK output profile supplied by IDEAlliance, downloaded from the [ICC profile registry](https://registry.color.org/profile-registry/CGATS21_CRPC6). Copyright X-Rite, Inc. The registry states: “This profile is made available by IDEAlliance®, with permission of X-Rite, Inc., and may be used, embedded, exchanged, and shared without restriction. It may not be altered, or sold without written permission of IDEAlliance.” This is a fixed test/example destination, not a recommended default for production jobs; use the printer's specified profile.

`DisplayP3-v4.icc` comes from [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles), under the included CC0 license. It exercises embedded wide-gamut source color information.

These fixtures live with the public tests so historical compatibility runs retain their original inputs. Exact decoder, conversion-engine, and serialized-encoding regressions belong in the private suite.
