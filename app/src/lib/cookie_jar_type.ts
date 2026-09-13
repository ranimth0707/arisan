/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cookie_jar.json`.
 */
export type CookieJar = {
  "address": "Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg",
  "metadata": {
    "name": "cookieJar",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "claimPrize",
      "discriminator": [
        157,
        233,
        139,
        121,
        246,
        62,
        234,
        235
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimTurn",
      "discriminator": [
        50,
        199,
        31,
        228,
        90,
        225,
        126,
        183
      ],
      "accounts": [
        {
          "name": "winner",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "winner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeCampaign",
      "discriminator": [
        65,
        49,
        110,
        7,
        63,
        238,
        206,
        77
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.creator",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "configureCircleRoom",
      "discriminator": [
        246,
        161,
        187,
        9,
        161,
        251,
        79,
        241
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "socialUrl",
          "type": "string"
        },
        {
          "name": "inviteCodeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "contribute",
      "discriminator": [
        82,
        33,
        68,
        131,
        32,
        0,
        205,
        95
      ],
      "accounts": [
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "crack",
      "discriminator": [
        196,
        252,
        76,
        139,
        68,
        46,
        178,
        32
      ],
      "accounts": [
        {
          "name": "claimer",
          "docs": [
            "Authorises the claim. Never charged for anything, so this may be a",
            "wallet holding exactly zero COOK."
          ],
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for the claim record. Usually the relayer, which reclaims",
            "it from the sponsor vault in the same transaction."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "envelope",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "envelope.creator",
                "account": "envelope"
              },
              {
                "kind": "account",
                "path": "envelope.envelopeId",
                "account": "envelope"
              }
            ]
          }
        },
        {
          "name": "envelopeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              }
            ]
          }
        },
        {
          "name": "claim",
          "docs": [
            "Creating this account is what makes a second claim impossible."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              },
              {
                "kind": "account",
                "path": "claimer"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "crackIntoJar",
      "discriminator": [
        246,
        13,
        176,
        113,
        41,
        242,
        193,
        103
      ],
      "accounts": [
        {
          "name": "claimer",
          "docs": [
            "Authorises the claim and ends up owning the position. Charged nothing,",
            "so a wallet with zero COOK can do this."
          ],
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for the claim record and the position."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "envelope",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "envelope.creator",
                "account": "envelope"
              },
              {
                "kind": "account",
                "path": "envelope.envelopeId",
                "account": "envelope"
              }
            ]
          }
        },
        {
          "name": "envelopeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              }
            ]
          }
        },
        {
          "name": "claim",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              },
              {
                "kind": "account",
                "path": "claimer"
              }
            ]
          }
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "jarVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "claimer"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createCampaign",
      "discriminator": [
        111,
        131,
        187,
        98,
        160,
        193,
        114,
        244
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for the campaign account. May be the relayer, so somebody",
            "with an empty wallet can still ask for help."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "campaignVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "story",
          "type": "string"
        },
        {
          "name": "target",
          "type": "u64"
        },
        {
          "name": "deadlineTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "createCircle",
      "discriminator": [
        186,
        99,
        49,
        131,
        31,
        51,
        13,
        198
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent. May be the relayer, so an empty wallet can still organise."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "circleId"
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "pot",
          "docs": [
            "Holds contributions. This is the pot that gets paid out."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "docs": [
            "Holds collateral. Separate from the pot on purpose: collateral belongs to",
            "the member until they default, and must never be payable as a prize."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "circleId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "socialUrl",
          "type": "string"
        },
        {
          "name": "inviteCodeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "contribution",
          "type": "u64"
        },
        {
          "name": "collateral",
          "type": "u64"
        },
        {
          "name": "maxMembers",
          "type": "u16"
        },
        {
          "name": "roundSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "createEnvelope",
      "discriminator": [
        2,
        25,
        194,
        180,
        238,
        31,
        234,
        20
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "envelope",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "envelopeId"
              }
            ]
          }
        },
        {
          "name": "envelopeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "envelopeId",
          "type": "u64"
        },
        {
          "name": "message",
          "type": "string"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "claimsTotal",
          "type": "u16"
        },
        {
          "name": "split",
          "type": {
            "defined": {
              "name": "splitMode"
            }
          }
        },
        {
          "name": "expiryTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "createJar",
      "discriminator": [
        79,
        12,
        25,
        249,
        245,
        177,
        203,
        232
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "jarId"
              }
            ]
          }
        },
        {
          "name": "jarVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jarId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "mode",
          "type": {
            "defined": {
              "name": "jarMode"
            }
          }
        },
        {
          "name": "startTs",
          "type": "i64"
        },
        {
          "name": "endTs",
          "type": "i64"
        },
        {
          "name": "minDeposit",
          "type": "u64"
        },
        {
          "name": "initialReward",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owns the position and supplies the deposit itself."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for a first-time position. May be the relayer, so a user",
            "bridging in for the first time is not blocked by rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "jarVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositGas",
      "discriminator": [
        164,
        223,
        20,
        23,
        50,
        107,
        168,
        108
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "sponsor",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "sponsorVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "donate",
      "discriminator": [
        121,
        186,
        218,
        211,
        73,
        70,
        196,
        180
      ],
      "accounts": [
        {
          "name": "donor",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for a first-time donation record."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.creator",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "donation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  111,
                  110,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "donor"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeDraw",
      "discriminator": [
        112,
        9,
        234,
        94,
        99,
        176,
        12,
        181
      ],
      "accounts": [
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "docs": [
            "the full sysvar is too large to deserialize on-chain."
          ],
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeTurn",
      "discriminator": [
        45,
        238,
        187,
        134,
        191,
        255,
        28,
        118
      ],
      "accounts": [
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "fundJar",
      "discriminator": [
        7,
        109,
        53,
        116,
        129,
        46,
        10,
        55
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "harvest",
      "discriminator": [
        228,
        241,
        31,
        182,
        53,
        169,
        59,
        199
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "relayer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "joinCircle",
      "discriminator": [
        231,
        168,
        235,
        18,
        99,
        12,
        22,
        7
      ],
      "accounts": [
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "room",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "inviteCodeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "leaveCircle",
      "discriminator": [
        90,
        250,
        45,
        116,
        132,
        126,
        209,
        126
      ],
      "accounts": [
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "redraw",
      "discriminator": [
        86,
        111,
        66,
        164,
        105,
        158,
        114,
        164
      ],
      "accounts": [
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "redrawTurn",
      "discriminator": [
        123,
        231,
        67,
        166,
        94,
        83,
        113,
        135
      ],
      "accounts": [
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "reimburseRelayer",
      "discriminator": [
        64,
        245,
        110,
        83,
        237,
        199,
        182,
        206
      ],
      "accounts": [
        {
          "name": "relayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sponsor",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "sponsor.authority",
                "account": "sponsor"
              }
            ]
          }
        },
        {
          "name": "sponsorVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sponsor.authority",
                "account": "sponsor"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "requestDraw",
      "discriminator": [
        22,
        180,
        8,
        81,
        47,
        21,
        86,
        159
      ],
      "accounts": [
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "requestTurn",
      "discriminator": [
        104,
        70,
        220,
        51,
        219,
        142,
        166,
        159
      ],
      "accounts": [
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setRelayer",
      "discriminator": [
        23,
        243,
        33,
        88,
        110,
        84,
        196,
        37
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "relayer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "slashAbsent",
      "discriminator": [
        43,
        91,
        26,
        165,
        123,
        12,
        53,
        142
      ],
      "accounts": [
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "membership.wallet",
                "account": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startCircle",
      "discriminator": [
        53,
        52,
        187,
        212,
        217,
        132,
        253,
        102
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "sweepEnvelope",
      "discriminator": [
        44,
        157,
        60,
        235,
        95,
        141,
        15,
        71
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "envelope",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "envelope.creator",
                "account": "envelope"
              },
              {
                "kind": "account",
                "path": "envelope.envelopeId",
                "account": "envelope"
              }
            ]
          }
        },
        {
          "name": "envelopeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  118,
                  101,
                  108,
                  111,
                  112,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "envelope"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "topUpBond",
      "discriminator": [
        110,
        37,
        8,
        119,
        210,
        231,
        202,
        197
      ],
      "accounts": [
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "jarVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawBond",
      "discriminator": [
        222,
        199,
        141,
        31,
        188,
        93,
        155,
        40
      ],
      "accounts": [
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.creator",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circle.circleId",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "withdrawGas",
      "discriminator": [
        35,
        60,
        150,
        196,
        226,
        110,
        54,
        45
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "sponsor",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "sponsorVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawRaised",
      "discriminator": [
        236,
        55,
        151,
        110,
        163,
        152,
        41,
        251
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.creator",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawToJar",
      "discriminator": [
        253,
        40,
        205,
        176,
        43,
        194,
        45,
        77
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Funds the rent for a first-time position."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.creator",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              }
            ]
          }
        },
        {
          "name": "jar",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "jar.creator",
                "account": "jar"
              },
              {
                "kind": "account",
                "path": "jar.jarId",
                "account": "jar"
              }
            ]
          }
        },
        {
          "name": "jarVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "jar"
              },
              {
                "kind": "account",
                "path": "creator"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "campaign",
      "discriminator": [
        50,
        40,
        49,
        11,
        157,
        220,
        229,
        192
      ]
    },
    {
      "name": "circle",
      "discriminator": [
        27,
        59,
        8,
        117,
        62,
        199,
        222,
        252
      ]
    },
    {
      "name": "circleRoom",
      "discriminator": [
        248,
        14,
        216,
        139,
        100,
        155,
        247,
        90
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "donation",
      "discriminator": [
        189,
        210,
        54,
        77,
        216,
        85,
        7,
        68
      ]
    },
    {
      "name": "envelope",
      "discriminator": [
        194,
        36,
        90,
        151,
        207,
        22,
        150,
        241
      ]
    },
    {
      "name": "envelopeClaim",
      "discriminator": [
        0,
        153,
        25,
        64,
        224,
        202,
        147,
        212
      ]
    },
    {
      "name": "jar",
      "discriminator": [
        197,
        50,
        234,
        142,
        247,
        216,
        114,
        137
      ]
    },
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "sponsor",
      "discriminator": [
        19,
        128,
        115,
        109,
        118,
        109,
        66,
        213
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6001,
      "name": "notAuthority",
      "msg": "Only the config authority may do this"
    },
    {
      "code": 6002,
      "name": "notRelayer",
      "msg": "Only the registered relayer may do this"
    },
    {
      "code": 6003,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6004,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "reimbursementTooLarge",
      "msg": "Reimbursement exceeds the per-transaction cap"
    },
    {
      "code": 6006,
      "name": "sponsorBalanceTooLow",
      "msg": "Sponsor vault does not hold enough COOK"
    },
    {
      "code": 6007,
      "name": "badJarDuration",
      "msg": "Jar duration is outside the allowed range"
    },
    {
      "code": 6008,
      "name": "startInPast",
      "msg": "Jar start time is in the past"
    },
    {
      "code": 6009,
      "name": "nameTooLong",
      "msg": "Jar name is too long"
    },
    {
      "code": 6010,
      "name": "jarEnded",
      "msg": "Jar reward window has already ended"
    },
    {
      "code": 6011,
      "name": "jarNotEnded",
      "msg": "Jar reward window has not ended yet"
    },
    {
      "code": 6012,
      "name": "belowMinDeposit",
      "msg": "Deposit is below the jar minimum"
    },
    {
      "code": 6013,
      "name": "insufficientPosition",
      "msg": "Position does not hold that much"
    },
    {
      "code": 6014,
      "name": "rewardVaultTooLow",
      "msg": "Reward vault does not hold enough COOK"
    },
    {
      "code": 6015,
      "name": "nothingToHarvest",
      "msg": "Nothing to harvest"
    },
    {
      "code": 6016,
      "name": "notProportionalJar",
      "msg": "This instruction is for Proportional jars only"
    },
    {
      "code": 6017,
      "name": "notLuckyJar",
      "msg": "This instruction is for Lucky jars only"
    },
    {
      "code": 6018,
      "name": "noEntries",
      "msg": "Jar has no eligible entries to draw from"
    },
    {
      "code": 6019,
      "name": "drawInProgress",
      "msg": "A draw is already in progress"
    },
    {
      "code": 6020,
      "name": "drawNotRequested",
      "msg": "No draw has been requested"
    },
    {
      "code": 6021,
      "name": "drawTooEarly",
      "msg": "Target slot has not been reached yet"
    },
    {
      "code": 6022,
      "name": "drawExpired",
      "msg": "Target slot has aged out of SlotHashes, request the draw again"
    },
    {
      "code": 6023,
      "name": "drawNotFinalized",
      "msg": "Draw has not been finalized"
    },
    {
      "code": 6024,
      "name": "notWinner",
      "msg": "This position did not win"
    },
    {
      "code": 6025,
      "name": "prizeAlreadyClaimed",
      "msg": "Prize has already been claimed"
    },
    {
      "code": 6026,
      "name": "claimWindowOpen",
      "msg": "The claim window has not closed yet"
    },
    {
      "code": 6027,
      "name": "winnerIneligible",
      "msg": "Winner no longer meets the jar minimum"
    },
    {
      "code": 6028,
      "name": "messageTooLong",
      "msg": "Envelope message is too long"
    },
    {
      "code": 6029,
      "name": "badClaimCount",
      "msg": "Envelope claim count is outside the allowed range"
    },
    {
      "code": 6030,
      "name": "envelopeTooSmall",
      "msg": "Envelope amount is too small for that many claims"
    },
    {
      "code": 6031,
      "name": "envelopeEmpty",
      "msg": "Envelope has no claims left"
    },
    {
      "code": 6032,
      "name": "envelopeExpired",
      "msg": "Envelope has expired"
    },
    {
      "code": 6033,
      "name": "envelopeNotExpired",
      "msg": "Envelope has not expired yet"
    },
    {
      "code": 6034,
      "name": "badExpiry",
      "msg": "Expiry must be in the future"
    },
    {
      "code": 6035,
      "name": "jarMismatch",
      "msg": "Envelope and jar do not use the same vault owner"
    },
    {
      "code": 6036,
      "name": "titleRequired",
      "msg": "A campaign needs a title"
    },
    {
      "code": 6037,
      "name": "titleTooLong",
      "msg": "Campaign title is too long"
    },
    {
      "code": 6038,
      "name": "storyTooLong",
      "msg": "Campaign story is too long"
    },
    {
      "code": 6039,
      "name": "campaignClosed",
      "msg": "This campaign is closed"
    },
    {
      "code": 6040,
      "name": "campaignEnded",
      "msg": "This campaign has passed its deadline"
    },
    {
      "code": 6041,
      "name": "nothingRaised",
      "msg": "Not that much has been raised"
    },
    {
      "code": 6042,
      "name": "badMemberCount",
      "msg": "A circle needs between 2 and 100 seats"
    },
    {
      "code": 6043,
      "name": "badRoundLength",
      "msg": "Round length is outside the allowed range"
    },
    {
      "code": 6044,
      "name": "collateralTooSmall",
      "msg": "Collateral must cover at least one contribution"
    },
    {
      "code": 6045,
      "name": "circleAlreadyStarted",
      "msg": "This circle has already started"
    },
    {
      "code": 6046,
      "name": "circleNotRunning",
      "msg": "This circle is not running"
    },
    {
      "code": 6047,
      "name": "circleNotFinished",
      "msg": "This circle has not finished"
    },
    {
      "code": 6048,
      "name": "circleFull",
      "msg": "Every seat is taken"
    },
    {
      "code": 6049,
      "name": "circleTooSmall",
      "msg": "A circle needs at least two members to start"
    },
    {
      "code": 6050,
      "name": "alreadyPaidThisRound",
      "msg": "You have already settled this round"
    },
    {
      "code": 6051,
      "name": "roundNotOver",
      "msg": "The round is not over yet"
    },
    {
      "code": 6052,
      "name": "nothingToSlash",
      "msg": "There is no collateral left to slash"
    },
    {
      "code": 6053,
      "name": "turnAlreadyDrawn",
      "msg": "This round has already been drawn"
    },
    {
      "code": 6054,
      "name": "notYourTurn",
      "msg": "This round is not yours"
    },
    {
      "code": 6055,
      "name": "alreadyHadATurn",
      "msg": "You have already had your turn"
    },
    {
      "code": 6056,
      "name": "memberSidelined",
      "msg": "Top your collateral back up first"
    },
    {
      "code": 6057,
      "name": "payFirst",
      "msg": "Pay this round before collecting it"
    },
    {
      "code": 6058,
      "name": "potEmpty",
      "msg": "The pot is empty"
    },
    {
      "code": 6059,
      "name": "nothingToWithdraw",
      "msg": "There is nothing to withdraw"
    },
    {
      "code": 6060,
      "name": "startRequiresCreatorOrFull",
      "msg": "Only the creator can start a circle before all seats are filled"
    },
    {
      "code": 6061,
      "name": "roomDescriptionRequired",
      "msg": "A campaign needs a description"
    },
    {
      "code": 6062,
      "name": "socialPostRequired",
      "msg": "The social post link is required"
    },
    {
      "code": 6063,
      "name": "invalidSocialPost",
      "msg": "The social post link is invalid"
    },
    {
      "code": 6064,
      "name": "inviteCodeRequired",
      "msg": "This room needs an invite code"
    },
    {
      "code": 6065,
      "name": "inviteCodeMismatch",
      "msg": "That invite code does not open this room"
    },
    {
      "code": 6066,
      "name": "roomRequired",
      "msg": "This circle has no campaign room yet"
    }
  ],
  "types": [
    {
      "name": "campaign",
      "docs": [
        "A request for help. Anyone can open one, there is no approval step and no",
        "platform cut, because the person asking is usually the one who can least",
        "afford either."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "story",
            "type": "string"
          },
          {
            "name": "target",
            "type": "u64"
          },
          {
            "name": "raised",
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "type": "u64"
          },
          {
            "name": "donorCount",
            "docs": [
              "Distinct wallets, not gifts. Giving twice does not inflate it."
            ],
            "type": "u64"
          },
          {
            "name": "donationCount",
            "type": "u64"
          },
          {
            "name": "deadlineTs",
            "type": "i64"
          },
          {
            "name": "closed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "circle",
      "docs": [
        "A rotating savings circle.",
        "",
        "Every field below is written once at creation and never changed, which is the",
        "reason anybody should be willing to join one: the organiser cannot raise the",
        "contribution or weaken the collateral after money is committed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "circleId",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "contribution",
            "docs": [
              "Owed by every member, every round."
            ],
            "type": "u64"
          },
          {
            "name": "collateral",
            "docs": [
              "Posted on joining. Missing a round is taken out of this."
            ],
            "type": "u64"
          },
          {
            "name": "maxMembers",
            "type": "u16"
          },
          {
            "name": "roundSeconds",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "circleState"
              }
            }
          },
          {
            "name": "memberCount",
            "type": "u16"
          },
          {
            "name": "round",
            "type": "u16"
          },
          {
            "name": "nextPayoutTs",
            "type": "i64"
          },
          {
            "name": "paidThisRound",
            "type": "u16"
          },
          {
            "name": "potAmount",
            "docs": [
              "What the pot holds right now. Reset to zero when a turn is collected."
            ],
            "type": "u64"
          },
          {
            "name": "winnersSoFar",
            "type": "u16"
          },
          {
            "name": "drawTargetSlot",
            "type": "u64"
          },
          {
            "name": "winnerIndex",
            "type": "u16"
          },
          {
            "name": "winnerDrawn",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "potBump",
            "type": "u8"
          },
          {
            "name": "bondBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "circleRoom",
      "docs": [
        "Public campaign details and the invite gate for a circle.",
        "",
        "Kept in its own PDA so adding room metadata does not invalidate Circle",
        "accounts that were created before campaign rooms existed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "socialUrl",
            "type": "string"
          },
          {
            "name": "inviteCodeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "circleState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "forming"
          },
          {
            "name": "running"
          },
          {
            "name": "finished"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "docs": [
              "Hot wallet that pays transaction fees. Fee payer only. It is never an",
              "authority over any vault in this program."
            ],
            "type": "pubkey"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new deposits. Withdrawals and harvests stay open."
            ],
            "type": "bool"
          },
          {
            "name": "jarCount",
            "type": "u64"
          },
          {
            "name": "envelopeCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "No campaign counter here on purpose. This account is already live on",
              "mainnet at its original size, and adding a field would push it past the",
              "space it was allocated. Campaigns are counted by listing them instead."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "donation",
      "docs": [
        "One per wallet per campaign. Its existence is what makes an honest donor",
        "count possible, and it doubles as the public record of who helped."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "donor",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "times",
            "type": "u16"
          },
          {
            "name": "firstTs",
            "type": "i64"
          },
          {
            "name": "lastTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "drawState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "notStarted"
          },
          {
            "name": "requested"
          },
          {
            "name": "finalized"
          }
        ]
      }
    },
    {
      "name": "envelope",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "envelopeId",
            "type": "u64"
          },
          {
            "name": "message",
            "type": "string"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          },
          {
            "name": "claimsTotal",
            "type": "u16"
          },
          {
            "name": "claimsDone",
            "type": "u16"
          },
          {
            "name": "split",
            "type": {
              "defined": {
                "name": "splitMode"
              }
            }
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "swept",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "envelopeClaim",
      "docs": [
        "Existence of this account is the proof that a wallet already claimed.",
        "Creating it twice fails at the runtime level, so double claims are",
        "impossible rather than merely checked."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "envelope",
            "type": "pubkey"
          },
          {
            "name": "claimer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimedAt",
            "type": "i64"
          },
          {
            "name": "intoJar",
            "docs": [
              "True when the claim went straight into a jar instead of a wallet."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "jar",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "jarId",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "jarMode"
              }
            }
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "rewardTotal",
            "docs": [
              "Total rewards ever funded into this jar."
            ],
            "type": "u64"
          },
          {
            "name": "rewardDistributed",
            "docs": [
              "Rewards accounted as streamed so far (Proportional only)."
            ],
            "type": "u64"
          },
          {
            "name": "rewardClaimed",
            "docs": [
              "Rewards actually paid out."
            ],
            "type": "u64"
          },
          {
            "name": "rewardRate",
            "docs": [
              "Lamports per second (Proportional only)."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "docs": [
              "Principal currently held in the jar vault. This is the TVL figure."
            ],
            "type": "u64"
          },
          {
            "name": "depositorCount",
            "type": "u64"
          },
          {
            "name": "accRewardPerShare",
            "docs": [
              "Reward-per-share accumulator, scaled by ACC_PRECISION."
            ],
            "type": "u128"
          },
          {
            "name": "lastUpdateTs",
            "type": "i64"
          },
          {
            "name": "entryCount",
            "docs": [
              "Entries handed out so far (Lucky only)."
            ],
            "type": "u64"
          },
          {
            "name": "minDeposit",
            "type": "u64"
          },
          {
            "name": "drawState",
            "type": {
              "defined": {
                "name": "drawState"
              }
            }
          },
          {
            "name": "drawTargetSlot",
            "type": "u64"
          },
          {
            "name": "winnerIndex",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "prizeClaimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "rewardVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "jarMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "proportional"
          },
          {
            "name": "lucky"
          }
        ]
      }
    },
    {
      "name": "member",
      "docs": [
        "One per wallet per circle. The public ledger everyone in the group can read:",
        "what you posted, what you paid, what you missed, whether you have had a turn."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "seat",
            "docs": [
              "Position in the circle, and what the draw selects."
            ],
            "type": "u16"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "paidRound",
            "docs": [
              "Last round this member settled, by paying or by being slashed."
            ],
            "type": "u16"
          },
          {
            "name": "roundsPaid",
            "type": "u16"
          },
          {
            "name": "roundsMissed",
            "type": "u16"
          },
          {
            "name": "hasWon",
            "type": "bool"
          },
          {
            "name": "active",
            "docs": [
              "False once collateral drops below one contribution. Cannot win until",
              "topped back up."
            ],
            "type": "bool"
          },
          {
            "name": "joinedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "jar",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "rewardDebt",
            "docs": [
              "Accumulator checkpoint, scaled by ACC_PRECISION."
            ],
            "type": "u128"
          },
          {
            "name": "pending",
            "docs": [
              "Settled but not yet transferred."
            ],
            "type": "u64"
          },
          {
            "name": "rewardsClaimed",
            "type": "u64"
          },
          {
            "name": "entryIndex",
            "docs": [
              "Entry number for Lucky jars. Meaningless unless `has_entry`."
            ],
            "type": "u64"
          },
          {
            "name": "hasEntry",
            "type": "bool"
          },
          {
            "name": "firstDepositTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "splitMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "equal"
          },
          {
            "name": "surprise"
          }
        ]
      }
    },
    {
      "name": "sponsor",
      "docs": [
        "One per sponsor. Sponsors fund their own users' gas rather than drawing from",
        "a shared pool, so nobody can spend someone else's balance."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "txSponsored",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "bondSeed",
      "type": "bytes",
      "value": "[98, 111, 110, 100]"
    },
    {
      "name": "campaignSeed",
      "type": "bytes",
      "value": "[99, 97, 109, 112, 97, 105, 103, 110]"
    },
    {
      "name": "campaignVaultSeed",
      "type": "bytes",
      "value": "[99, 97, 109, 112, 97, 105, 103, 110, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "circleSeed",
      "type": "bytes",
      "value": "[99, 105, 114, 99, 108, 101]"
    },
    {
      "name": "claimSeed",
      "type": "bytes",
      "value": "[99, 108, 97, 105, 109]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "donationSeed",
      "type": "bytes",
      "value": "[100, 111, 110, 97, 116, 105, 111, 110]"
    },
    {
      "name": "envelopeSeed",
      "type": "bytes",
      "value": "[101, 110, 118, 101, 108, 111, 112, 101]"
    },
    {
      "name": "envelopeVaultSeed",
      "type": "bytes",
      "value": "[101, 110, 118, 101, 108, 111, 112, 101, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "jarSeed",
      "type": "bytes",
      "value": "[106, 97, 114]"
    },
    {
      "name": "jarVaultSeed",
      "type": "bytes",
      "value": "[106, 97, 114, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "maxFeeReimbursement",
      "docs": [
        "Hard cap on what the relayer may reclaim per sponsored transaction.",
        "",
        "It covers two things the relayer fronts on a user's behalf: the transaction",
        "fee (10,000 lamports observed on Cookie Chain) and the rent for any account",
        "the instruction opens, which is about 3.3M lamports for a position plus a",
        "claim record. The cap is what bounds the damage if the relayer key leaks:",
        "draining a 2,000 COOK vault would take 400,000 separate transactions."
      ],
      "type": "u64",
      "value": "5000000"
    },
    {
      "name": "memberSeed",
      "type": "bytes",
      "value": "[109, 101, 109, 98, 101, 114]"
    },
    {
      "name": "positionSeed",
      "type": "bytes",
      "value": "[112, 111, 115, 105, 116, 105, 111, 110]"
    },
    {
      "name": "potSeed",
      "type": "bytes",
      "value": "[112, 111, 116]"
    },
    {
      "name": "rewardVaultSeed",
      "type": "bytes",
      "value": "[114, 101, 119, 97, 114, 100, 95, 118, 97, 117, 108, 116]"
    },
    {
      "name": "roomSeed",
      "type": "bytes",
      "value": "[114, 111, 111, 109]"
    },
    {
      "name": "sponsorSeed",
      "type": "bytes",
      "value": "[115, 112, 111, 110, 115, 111, 114]"
    },
    {
      "name": "sponsorVaultSeed",
      "type": "bytes",
      "value": "[115, 112, 111, 110, 115, 111, 114, 95, 118, 97, 117, 108, 116]"
    }
  ]
};
