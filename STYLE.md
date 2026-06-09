# diamond-pau Solidity Style Guide

Complete reference for code style in this repository. Rules marked **[enforced]** are checked by
`weld lint` and/or auto-fixed by `weld format`. Everything else is a **[convention]** that
should be followed but is not yet mechanically checked.

---

## Table of Contents

1. [File-level structure](#1-file-level-structure)
2. [Imports](#2-imports)
3. [Contract / interface structure](#3-contract--interface-structure)
4. [Section headers](#4-section-headers)
5. [Naming](#5-naming)
6. [Spacing & blank lines](#6-spacing--blank-lines)
7. [Function signatures](#7-function-signatures)
8. [Modifier order](#8-modifier-order)
9. [Expressions & statements](#9-expressions--statements)
10. [Alignment](#10-alignment)
11. [NatSpec & comments](#11-natspec--comments)
12. [Storage patterns (ERC-7201)](#12-storage-patterns-erc-7201)
13. [Error handling](#13-error-handling)
14. [Events](#14-events)
15. [Assembly](#15-assembly)
16. [Test files](#16-test-files)

---

## 1. File-level structure

### SPDX & pragma **[enforced]**

Every file must start with an SPDX identifier and a pragma, in this order, with a blank line between
them. The expected SPDX license and pragma version are **configurable** (`weld.config.json` →
`solidity.spdx` / `solidity.pragma`); the defaults are:

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.34;
```

- SPDX must match `solidity.spdx` (`file/spdx`) — set it to your repo's license (e.g. `BUSL-1.1`,
  `MIT`), or `null` to require only that *some* SPDX identifier is present
- Pragma must match `solidity.pragma` (`file/pragma-version`) — e.g. `^0.8.34` or `0.8.30`
- A blank line must follow the pragma before the first import (`file/blank-after-pragma`)

### File order **[convention]**

```
1. SPDX comment
   (blank)
2. pragma
   (blank)
3. Imports  (see §2)
   (blank)
4. File-level interfaces / helper types used only by this file
   (blank)
5. Main contract / interface / library declaration
```

---

## 2. Imports

### Named imports only **[enforced]**

Always destructure the imported symbol — never use bare or wildcard imports.

```solidity
// ✓ correct
import { ApproveLib }     from "../../libraries/ApproveLib.sol";
import { makeAddressKey } from "../../libraries/RateLimitHelpers.sol";

// ✗ wrong
import "../../libraries/ApproveLib.sol";
import * as Lib from "../../libraries/ApproveLib.sol";
```

(`imports/named-only`)

### Multi-symbol imports **[convention]**

When importing more than one symbol from the same file, prefer a single-line form. If the line
would be very long, use the multi-line brace form:

```solidity
// single-line (preferred for 1-2 symbols)
import { RateLimits, IRateLimits } from "../../../src/RateLimits.sol";

// multi-line brace form (when line is too long)
import {
    AccessControlEnumerable
} from "../../lib/openzeppelin-contracts/.../AccessControlEnumerable.sol";
```

### Import grouping & order **[convention]**

Separate groups with a single blank line. Within each group, order is not strictly enforced but
the common pattern is:

```
1. External libraries (lib/ — deepest dependency first)
2. Internal libraries / utilities (src/libraries/)
3. Internal interfaces (src/interfaces/)
4. Internal contracts (src/*.sol)
5. Local facet files (same subdirectory — ./ and ../)
```

```solidity
import { FullMath }    from "../../../lib/dss-allocator/src/funnels/uniV3/FullMath.sol";
import { TickMath }    from "../../../lib/dss-allocator/src/funnels/uniV3/TickMath.sol";

import { ApproveLib }            from "../../libraries/ApproveLib.sol";
import { makeAddressAddressKey } from "../../libraries/RateLimitHelpers.sol";

import { IALMProxy }   from "../../interfaces/IALMProxy.sol";
import { IRateLimits } from "../../interfaces/IRateLimits.sol";

import { FacetBase } from "../FacetBase.sol";

import { IUniswapV3Facet } from "./IUniswapV3Facet.sol";
```

### Import alignment **[enforced]**

Within a group of consecutive single-line imports, the `from` keyword must align to the column of
the longest import in that group. (`imports/alignment`)

```solidity
// ✓ aligned
import { ApproveLib }     from "../../libraries/ApproveLib.sol";
import { makeAddressKey } from "../../libraries/RateLimitHelpers.sol";

// ✓ aligned
import { IAaveFacet }          from "../../src/facets/aave/IAaveFacet.sol";
import { ICCTPFacet }          from "../../src/facets/cctp/ICCTPFacet.sol";
import { ITransferAssetFacet } from "../../src/facets/transfer-asset/ITransferAssetFacet.sol";

// ✗ unaligned
import { IAaveFacet } from "../../src/facets/aave/IAaveFacet.sol";
import { ITransferAssetFacet } from "../../src/facets/transfer-asset/ITransferAssetFacet.sol";
```

The formatter (`weld format`) will automatically align import groups.

---

## 3. Contract / interface structure

### Declaration **[convention]**

Contract declarations use blank lines before and after the opening brace:

```solidity
contract AaveFacet is IAaveFacet, FacetBase {

    /*** first section ***/
```

```solidity
interface IAaveFacet is IFacetBase {

    /*** first section ***/
```

The body opens with a blank line (after `{`) and closes with a blank line (before `}`).

### Section ordering in contracts **[convention]**

Sections must appear in this order, each separated by a section header (see §4):

```
1. Storage Domain       (ERC-7201 struct + constant + getter)
2. Constants            (public constants, immutables)
3. Declarations         (immutable state variables)
4. Structs              (if not in interface)
5. Events               (if not in interface)
6. Custom Errors        (if not in interface)
7. Modifiers
8. Constructor
9. External/Public interactive functions
10. External/Public view/pure functions
11. Internal functions
12. Fallback / receive
```

Not every section will exist in every contract — only include the headers that apply.

### Section ordering in interfaces **[convention]**

```
1. Structs
2. Events
3. Custom Errors
4. State-variable getters (view functions exposing public state)
5. Admin / mutating functions
6. View / pure functions
```

---

## 4. Section headers

### Format **[enforced]**

Section headers are a three-line banner comment. The total line length (including leading
indentation) must be exactly **100 characters**:

```
    /**********************************************************************************************/
    /*** Section Name                                                                            ***/
    /**********************************************************************************************/
```

- Line 1 and 3: `/` + N `*` + `/` where the total line length = 100
- Line 2: `/*** ` + title + spaces + ` ***/` padded to 100 chars
- 4-space indent at contract level → 96 chars of comment
- 8-space indent inside nested blocks → 92 chars of comment

(`structure/section-header-format` — auto-fixable)

### Placement **[convention]**

Section headers are preceded and followed by a blank line:

```solidity
contract Foo {

    /**********************************************************************************************/
    /*** Constants                                                                              ***/
    /**********************************************************************************************/

    bytes32 public constant LIMIT_DEPOSIT = keccak256("LIMIT_AAVE_DEPOSIT");

    /**********************************************************************************************/
    /*** External interactive functions                                                         ***/
    /**********************************************************************************************/

    function deposit(...) external { ... }

}
```

### Line length **[enforced]**

Code lines wrap at **120 columns**. `weld format` splits over-long single-line function / event /
error declarations onto multiple lines (one parameter per line), and collapses a *wrapped* function /
event / error back to a single line when the result is **≤ 90 columns**. The **90–120 band is a
no-reflow zone** that preserves the author's wrapping choice either way — 90 is deliberately set below
the point where the canonical codebase starts hand-wrapping declarations, so the formatter never
fights the audited style.

```solidity
// collapsed (≤ 90): a short wrapped signature is pulled back onto one line
function addStrategy(address strategy) external;

// left wrapped (in the 90–120 band or genuinely > 120): author's layout is respected
function setRateLimitData(bytes32 key, uint256 maxAmount, uint256 slope, uint256 lastAmount)
    external
    onlyRole(DEFAULT_ADMIN_ROLE);
```

> Note: this is distinct from the **section-header banner**, which is a fixed **100** characters
> total (§4).

---

## 5. Naming

### Contracts & interfaces **[enforced]**

| Kind | Convention | Example |
|---|---|---|
| `contract` | PascalCase | `AaveFacet`, `Controller` |
| `abstract contract` | PascalCase | `FacetBase`, `ControllerSharedStorage` |
| `interface` | `I` + PascalCase | `IAaveFacet`, `IController` |
| `library` | PascalCase | `ApproveLib`, `UniswapV3Utils` |
| Minimal local interface | `I` prefix + descriptive + optional `Like` suffix | `IPoolLike`, `IERC20Like`, `IATokenWithPoolLike` |

All interfaces must start with `I`. (`naming/interface-i-prefix`)

### Constants **[enforced]**

All constants (state-variable level) must be `UPPER_SNAKE_CASE`:

```solidity
bytes32 public constant LIMIT_DEPOSIT  = keccak256("LIMIT_AAVE_DEPOSIT");
bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER");
bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

// internal: same UPPER_SNAKE, optionally _ prefix for "private" constants
bytes32 internal constant FACET_STORAGE_LOCATION = 0x...;
bytes32 internal constant _DEFAULT_ADMIN_ROLE     = 0x00;     // shadows a public inherited constant
uint256 internal constant _V4_SWAP               = 0x10;
```

(`naming/constants-upper-snake`)

### Events **[enforced]**

PascalCase, descriptive, no `Event` suffix. (`naming/events-pascal-case`)

```solidity
event AaveMaxSlippageSet(address indexed aToken, uint256 maxSlippage);
event RateLimitDataSet(bytes32 indexed key, ...);
event RelayerRemoved(address indexed relayer);
```

### Custom errors **[enforced]**

PascalCase, no `Error` suffix. (`naming/errors-pascal-case`, `naming/errors-no-error-suffix`)

```solidity
error ZeroAdmin();
error NotAdmin(address caller);
error DispatchNotFound(bytes4 callSelector);
error AccessControlUnauthorizedAccount(address account, bytes32 role);
```

### Functions **[enforced]**

| Visibility | Prefix | Example |
|---|---|---|
| `external` / `public` | none — camelCase | `deposit`, `setMaxSlippage`, `getMaxSlippage` |
| `internal` / `private` in **contracts** | `_` + camelCase | `_getFacetStorage`, `_decreaseRateLimit` |
| `internal` in **libraries** | no prefix | `approve` (ApproveLib), `toInt256` (SafeCast) |
| Free functions (file-level) | no prefix | `makeAddressKey`, `makeUint32Key` |

(`naming/internal-functions-prefix` — only applied to `contract`/`abstract`, not `library`)

### Storage getter return variable **[enforced]**

Functions matching `_get*Storage()` that return a `storage` pointer must name the return variable
`$`:

```solidity
function _getFacetStorage() internal pure returns (FacetStorage storage $) {
    assembly { $.slot := FACET_STORAGE_LOCATION }
}
```

(`naming/storage-pointer-dollar`)

### Local variables **[convention]**

camelCase. Storage pointers that are used like a local cache are also `$` or end with `$`:

```solidity
SharedControllerStorage storage $ = _getSharedControllerStorage();

address proxy      = $.proxy;
address rateLimits = $.rateLimits;
```

### Immutables **[convention]**

camelCase, no prefix:

```solidity
address public immutable permit2;
address public immutable positionManager;
```

### Mappings **[convention]**

Include key-name annotation for readability. Note the **space after `mapping`** (`mapping (` —
dss/Sky house style), and that the variable names are column-aligned:

```solidity
mapping (address aToken => uint256 maxSlippage) maxSlippages;
mapping (bytes32 poolId => TickLimits limits)   tickLimits;
mapping (bytes32 => RateLimitData)              private _data;
```

(`mapping(` is normalised to `mapping (` by `weld format`.)

---

## 6. Spacing & blank lines

### Contract body **[convention]**

- One blank line after the opening `{` of a contract/interface
- One blank line before the closing `}`
- One blank line between functions
- Two blank lines between major sections (the section header provides the visual break)

```solidity
contract Foo {
                                      ← blank line
    /*** ... ***/
                                      ← blank line
    function foo() external { ... }
                                      ← blank line
    function bar() external { ... }
                                      ← blank line
}
```

### Interface body **[convention]**

Same rules as contracts. Each function declaration gets its own blank lines:

```solidity
interface IFoo {

    function foo() external;

    function bar() external returns (uint256);

}
```

### Inside functions **[convention]**

- Blank line between logical groupings inside a function body
- No blank line directly after `{` or before `}`  inside a function
- Related statements grouped together without blank lines

```solidity
function deposit(address aToken, uint256 amount) external nonReentrant onlyRole(RELAYER_ROLE) {
    SharedControllerStorage storage $ = _getSharedControllerStorage();

    address proxy = $.proxy;

    _decreaseRateLimit($.rateLimits, LIMIT_DEPOSIT, aToken, amount);

    uint256 maxSlippage = _getFacetStorage().maxSlippages[aToken];
    require(maxSlippage != 0, "AaveFacet/max-slippage-not-set");

    address underlying = IATokenWithPoolLike(aToken).UNDERLYING_ASSET_ADDRESS();
    address pool       = IATokenWithPoolLike(aToken).POOL();

    ApproveLib.approve(underlying, proxy, pool, amount);
    ...
}
```

### Struct literals **[convention]**

When constructing a struct literal, each field on its own line, with the field name padded so the
`:` aligns in a column (space **before** the colon):

```solidity
_data[key] = RateLimitData({
    maxAmount   : maxAmount,
    slope       : slope,
    lastAmount  : lastAmount,
    lastUpdated : lastUpdated
});
```

(`weld format` aligns the colons. The legacy attached form `maxAmount:   maxAmount` is reformatted
to this aligned form.)

---

## 7. Function signatures

### Short functions (fit on one line) **[convention]**

```solidity
function getMaxSlippage(address aToken) external view returns (uint256) {
    return _getFacetStorage().maxSlippages[aToken];
}
```

### Multi-line signatures **[convention]**

When a function needs multiple lines, place each modifier on its own line after the parameter
list, with the opening brace on the same line as the last modifier (or returns clause):

```solidity
function setMaxSlippage(address aToken, uint256 maxSlippage)
    external
    nonReentrant
    onlyRole(DEFAULT_ADMIN_ROLE)
{
    ...
}
```

```solidity
function deposit(
    address aToken,
    uint256 amount
)
    external
    nonReentrant
    onlyRole(RELAYER_ROLE)
{
    ...
}
```

```solidity
function withdraw(address aToken, uint256 amount)
    external
    nonReentrant
    onlyRole(RELAYER_ROLE)
    returns (uint256 amountWithdrawn)
{
    ...
}
```

When there is a `returns` clause, it appears after the last modifier:

```solidity
function getDispatch(bytes4 callSelector)
    external
    view
    returns (address facet, bytes4 delegateSelector)
{
    ...
}
```

### Multi-line parameters **[convention]**

When a parameter list itself is multi-line, each param on its own line, indented 4 extra spaces
relative to `function`:

```solidity
function setRateLimitData(
    bytes32 key,
    uint256 maxAmount,
    uint256 slope,
    uint256 lastAmount,
    uint256 lastUpdated
)
    public
    override
    onlyRole(DEFAULT_ADMIN_ROLE)
{
    ...
}
```

### Interface function declarations **[convention]**

Follow the same multi-line rules. Single-line declarations for short signatures:

```solidity
function deposit(address aToken, uint256 amount) external;
function setMaxSlippage(address aToken, uint256 maxSlippage) external;
function getMaxSlippage(address aToken) external view returns (uint256);
```

Multi-line when needed:

```solidity
function triggerRateLimitDecrease(bytes32 key, uint256 amountToDecrease)
    external
    returns (uint256 newLimit);
```

---

## 8. Modifier order

**[enforced]** (`structure/modifier-order`)

Modifiers must appear in this order on a function:

```
1. visibility        (external / public / internal / private)
2. view / pure       (state mutability)
3. payable
4. override
5. virtual
6. nonReentrant
7. onlyRole(...)
8. initializer
```

```solidity
// ✓ correct
function foo() external nonReentrant onlyRole(RELAYER_ROLE) { ... }
function bar() public view override returns (bool) { ... }
function baz() external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) { ... }

// ✗ wrong — onlyRole before nonReentrant
function foo() external onlyRole(RELAYER_ROLE) nonReentrant { ... }
```

---

## 9. Expressions & statements

### `require` **[convention / warn]**

Prefer custom errors over string literals. (`patterns/require-custom-errors` — warning)

```solidity
// ✓ preferred — custom error
require(admin != address(0), ZeroAdmin());
require(facet != address(0), DispatchNotFound(msg.sig));

// ✓ also accepted — string format "Contract/error-description"
require(maxSlippage != 0, "AaveFacet/max-slippage-not-set");
require(pool != address(0), "CurveFacet/pool-zero-address");
```

String format (where used) is `"ContractName/kebab-case-description"`.

Multi-line requires when the condition is complex:

```solidity
require(
    minLpAmount >= valueDeposited * maxSlippage / ICurvePoolLike(pool).get_virtual_price(),
    "CurveFacet/min-amount-not-met"
);
```

### Inline condition alignment **[enforced]**

In a run of consecutive single-line `require` calls, the error argument (after the comma) is aligned
into a column. `weld format` does this automatically.

The operands *inside* the condition are aligned **only when every condition in the run shares the
same comparison operator** — then the left-hand sides are padded so the operator forms a column:

```solidity
// same operator (<=) → operands aligned AND error column aligned
require(lastAmount  <= maxAmount,       "RateLimits/invalid-lastAmount");
require(lastUpdated <= block.timestamp, "RateLimits/invalid-lastUpdated");
```

```solidity
// mixed operators → conditions left verbatim, only the error column is aligned
require(config.facet != address(0),   ZeroFacet());
require(config.facet.code.length > 0, EmptyFacet());
require(config.wires.length > 0,      EmptyArray());
```

### Emit **[convention]**

Inline emit pattern — the assigned value is emitted in the same expression:

```solidity
emit CurveMaxSlippageSet(pool, _getFacetStorage().maxSlippages[pool] = maxSlippage);
emit DispatchSet(callSelector, facet, delegateSelector);
```

### Function calls — multi-line **[convention]**

When arguments don't fit on one line, each arg on its own line:

```solidity
ApproveLib.approve(
    ICurvePoolLike(pool).coins(i),
    proxy,
    pool,
    depositAmounts[i]
);

abi.encodeCall(IPoolLike.supply, (underlying, amount, proxy, 0))
```

### `abi.decode` **[convention]**

```solidity
// Short — single line
uint256 withdrawn = abi.decode(result, (uint256));

// Long — multi-line
amountWithdrawn = abi.decode(
    IALMProxy(proxy).doCall(
        pool,
        abi.encodeCall(IPoolLike.withdraw, (...))
    ),
    (uint256)
);
```

---

## 10. Alignment

All alignment rules are auto-fixed by `weld format`.

### Import `from` alignment **[enforced]**

Within a group of consecutive single-line imports, `from` must align to the longest declaration.
(`imports/alignment`)

### Same-type consecutive declarations **[enforced]**

Sequential declarations of the same type align their `=` operator:

```solidity
// ✓ aligned
address proxy      = $.proxy;
address rateLimits = $.rateLimits;

// ✓ aligned
address internal admin        = makeAddr("admin");
address internal deployer     = makeAddr("deployer");
address internal freezer      = makeAddr("freezer");
address internal relayer      = makeAddr("relayer");
address internal unauthorized = makeAddr("unauthorized");
```

### Same-type constants **[convention]**

```solidity
bytes32 public constant LIMIT_DEPOSIT  = keccak256("LIMIT_AAVE_DEPOSIT");
bytes32 public constant LIMIT_WITHDRAW = keccak256("LIMIT_AAVE_WITHDRAW");
```

### Event parameter type-column alignment **[convention]**

In multi-line event declarations, types and names align in columns:

```solidity
event RateLimitDataSet(
    bytes32 indexed key,
    uint256         maxAmount,
    uint256         slope,
    uint256         lastAmount,
    uint256         lastUpdated
);
```

### Struct field type-column alignment **[convention]**

```solidity
struct FacetStorage {
    mapping (address pool => uint256 maxSlippage) maxSlippages;  // 1e18 precision
    mapping (bytes32 poolId => TickLimits limits) tickLimits;
}
```

### Multi-line function parameter type-column alignment **[convention]**

When parameter types differ in length, align names in a second column:

```solidity
function remove_liquidity(
    uint256          burnAmount,
    uint256[] memory minAmounts,
    address          receiver
)
    external;
```

### Consecutive call-argument alignment **[enforced in source]**

A run of consecutive single-line statement calls to the **same function** aligns its argument
columns: each argument is padded after its comma so the next column lines up. `weld format` applies
this automatically in **source files** (it is 100% consistent across the canonical `src`).

```solidity
_decreaseRateLimit(getAggregateDepositRateLimitKey(pool),     aggregateAmount);
_decreaseRateLimit(getAssetDepositRateLimitKey(pool, token0), amounts.amount0);
_decreaseRateLimit(getAssetDepositRateLimitKey(pool, token1), amounts.amount1);
```

### `assertEq` / test assertion column alignment **[convention]**

In tests, align the second argument of assertion calls when checking multiple related values:

```solidity
assertEq(accessControls.supportsInterface(type(IAccessControls).interfaceId),          true);
assertEq(accessControls.supportsInterface(type(IAccessControlEnumerable).interfaceId), true);
assertEq(accessControls.supportsInterface(type(IAccessControl).interfaceId),           true);
assertEq(accessControls.supportsInterface(type(IERC165).interfaceId),                  true);
```

> `weld format` does **not** auto-apply call-argument alignment inside test files (`.t.sol`): there
> the convention is applied with judgment (assertion tables with very disparate values are left
> ragged on purpose), so it is a hand-maintained convention in tests rather than an enforced rule.

---

## 11. NatSpec & comments

### Multi-line NatSpec **[convention]**

Used on public/external functions, events, structs, and state variables in interfaces.
Format uses `/**` opener, ` * ` body lines, ` */` closer:

```solidity
/**
 * @dev   Struct representing a rate limit.
 *        The current rate limit is calculated using the formula:
 *        `currentRateLimit = min(slope * (block.timestamp - lastUpdated) + lastAmount, maxAmount)`.
 * @param maxAmount   Maximum allowed amount at any time.
 * @param slope       The slope of the rate limit. [tokens / second]
 * @param lastAmount  The amount left available at the last update.
 * @param lastUpdated The timestamp when the rate limit was last updated.
 */
struct RateLimitData { ... }
```

- `@dev` for implementation notes
- `@notice` for user-facing summaries (optional — `@dev` is acceptable)
- `@param` for each parameter, names aligned
- `@return` for named returns
- `@custom:storage-location` for ERC-7201 storage structs (see §12)

### Inline comments **[convention]**

Explanatory comment above the statement:

```solidity
// Approve underlying to Aave pool from the proxy (assumes the proxy has enough underlying).
ApproveLib.approve(underlying, proxy, pool, amount);
```

For important clarifications use `NOTE:`:

```solidity
// NOTE: This logic was inspired by OpenZeppelin's forceApprove in SafeERC20 library.
```

For precision annotations inline at end of line:

```solidity
mapping (address pool => uint256 maxSlippage) maxSlippages;  // 1e18 precision
```

### Static analysis suppressions **[convention]**

Use inline `slither-disable-next-line` when required:

```solidity
// slither-disable-next-line assembly
assembly { ... }
```

---

## 12. Storage patterns (ERC-7201)

### Required triplet **[enforced]**

Every diamond facet that has per-facet storage must implement exactly this triplet:

```solidity
/// @custom:storage-location erc7201:sky.pau.storage.FacetName
struct FacetStorage {
    // fields ...
}

// keccak256(abi.encode(uint256(keccak256("sky.pau.storage.FacetName")) - 1)) & ~bytes32(uint256(0xff))
bytes32 internal constant FACET_STORAGE_LOCATION =
    0x<precomputed_hash>;

function _getFacetStorage() internal pure returns (FacetStorage storage $) {
    assembly {
        $.slot := FACET_STORAGE_LOCATION
    }
}
```

Rules:
- Storage constant must end with `_LOCATION` (`patterns/storage-location-suffix`)
- Getter must return variable named `$` (`patterns/erc7201-getter-dollar`, `naming/storage-pointer-dollar`)
- Struct annotated with `@custom:storage-location erc7201:sky.pau.storage.<Name>`
- Comment above constant shows the keccak formula for auditability

### Shared storage access **[convention]**

Access shared controller storage at the top of a function body and bind to `$`:

```solidity
SharedControllerStorage storage $ = _getSharedControllerStorage();

address proxy = $.proxy;
```

---

## 13. Error handling

### Custom errors (preferred) **[warn]**

Custom errors are preferred. (`patterns/require-custom-errors`)

```solidity
// ✓ best — custom error object passed directly
require(admin != address(0), ZeroAdmin());

// ✓ also used — string literals in "Contract/error" format
require(aToken != address(0), "AaveFacet/aToken-zero-address");
```

### Revert style **[convention]**

Use `revert` directly for errors with constructor arguments:

```solidity
revert AccessControlUnauthorizedAccount(msg.sender, role);
```

Use `require` for assertion-style checks:

```solidity
require(condition, CustomError(args));
require(condition, "Contract/error-message");
```

### String error format **[convention]**

Where string errors are used: `"ContractName/kebab-case-description"` — no spaces, kebab-case:

```solidity
"AaveFacet/max-slippage-not-set"
"RateLimits/invalid-lastAmount"
"CurveFacet/pool-zero-address"
```

---

## 14. Events

### Declaration **[enforced]**

PascalCase name, no `Event` suffix. (`naming/events-pascal-case`)

### Indexed parameters **[enforced/warn]**

`bytes32` parameters named `key`, `role`, or `callSelector` must be `indexed`.
(`patterns/event-indexed-key`)

General guidance: index up to 3 parameters; prefer indexing lookup keys (`address`, `bytes32 key`)
over value fields (`uint256 amount`):

```solidity
event RateLimitDataSet(
    bytes32 indexed key,       // ← indexed (lookup key)
    uint256         maxAmount, // ← not indexed (value)
    uint256         slope,
    uint256         lastAmount,
    uint256         lastUpdated
);

event AaveMaxSlippageSet(address indexed aToken, uint256 maxSlippage);
event RelayerRemoved(address indexed relayer);
```

---

## 15. Assembly

### Usage **[convention]**

Assembly is only used for:
1. ERC-7201 storage slot assignment
2. Low-level return forwarding in fallback functions

### Format **[convention]**

Single-line when trivial:

```solidity
assembly {
    $.slot := FACET_STORAGE_LOCATION
}
```

Multi-line for switch statements:

```solidity
assembly {
    switch success
    case 0  { revert(add(returnData, 0x20), mload(returnData)) }
    default { return(add(returnData, 0x20), mload(returnData)) }
}
```

Always suppress Slither's assembly warning above the block:

```solidity
// slither-disable-next-line assembly
assembly { ... }
```

---

## 16. Test files

### File naming **[convention]**

`ContractName.t.sol` (`.t.sol` suffix required for Forge test discovery).

### Contract naming **[enforced]**

| Kind | Suffix | Example |
|---|---|---|
| Test suite | `*Tests` or `*_Tests` | `AccessControls_Tests`, `ALMProxy_DoCall_FailureTests` |
| Abstract base | `*TestBase` or `*_TestBase` | `RateLimits_TestBase`, `UnitTestBase` |
| Harness | `*Harness` | `ControllerHarness` |
| Mock | `Mock*` | `MockPSM`, `MockTarget` |

(`naming/test-contracts-suffix`)

### Test function naming **[enforced]**

```
test_featureOrScenario            → basic success/failure
test_functionName_scenarioDetails → specific function tests
testFuzz_functionName_scenario    → fuzz tests
```

```solidity
function test_constructor() external { ... }
function test_constructor_zeroAdmin() external { ... }
function test_removeRelayer_notFreezer() external { ... }
function testFuzz_addLiquidityCurve_swapRateLimit(uint256 a, uint256 b) external { ... }
```

(`naming/test-functions-prefix`)

### `setUp` visibility **[enforced]**

`setUp` must be `external`:

```solidity
function setUp() external {
    vm.prank(deployer);
    accessControls = new AccessControls(admin);
}
```

(`structure/setup-external`)

### State variables **[convention]**

```solidity
bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
bytes32 constant FREEZER_ROLE = keccak256("FREEZER");

address internal admin        = makeAddr("admin");
address internal deployer     = makeAddr("deployer");
address internal freezer      = makeAddr("freezer");
address internal relayer      = makeAddr("relayer");
address internal unauthorized = makeAddr("unauthorized");

AccessControls internal accessControls;
```

### Expect revert / emit patterns **[convention]**

```solidity
// Custom error with selector
vm.expectRevert(IAccessControls.ZeroAdmin.selector);

// Custom error with arguments
vm.expectRevert(abi.encodeWithSelector(
    IAccessControl.AccessControlUnauthorizedAccount.selector,
    unauthorized,
    accessControls.FREEZER_ROLE()
));

// Emit check
vm.expectEmit(address(accessControls));
emit IAccessControls.RelayerRemoved(relayer);
```

### Helper functions **[convention]**

Internal helper functions use `_` prefix and describe what they assert/compute:

```solidity
function _assertLimitData(
    bytes32 key,
    uint256 maxAmount,
    uint256 slope,
    uint256 lastAmount,
    uint256 lastUpdated
)
    internal view
{
    IRateLimits.RateLimitData memory d = rateLimits.getRateLimitData(key);
    assertEq(d.maxAmount,   maxAmount);
    assertEq(d.slope,       slope);
    assertEq(d.lastAmount,  lastAmount);
    assertEq(d.lastUpdated, lastUpdated);
}
```

---

## weld rule reference

| Rule ID | Severity | Auto-fix | Description |
|---|---|---|---|
| `file/spdx` | error | no | SPDX must match `solidity.spdx` (configurable; `null` = any) |
| `file/pragma-version` | error | no | pragma must match `solidity.pragma` (configurable) |
| `file/blank-after-pragma` | warn | yes | blank line required after pragma |
| `imports/named-only` | error | no | no bare or wildcard imports |
| `imports/alignment` | warn | yes | `from` must align within import groups |
| `naming/interface-i-prefix` | error | no | interfaces must start with `I` |
| `naming/constants-upper-snake` | warn | no | constants must be `UPPER_SNAKE_CASE` |
| `naming/events-pascal-case` | error | no | events must be PascalCase |
| `naming/errors-pascal-case` | error | no | custom errors must be PascalCase |
| `naming/errors-no-error-suffix` | warn | no | custom errors must not end with `Error` |
| `naming/internal-functions-prefix` | error | no | internal contract functions must start with `_` |
| `naming/storage-pointer-dollar` | error | no | `_get*Storage()` return var must be `$` |
| `naming/test-functions-prefix` | warn | no | test functions must use `test_` prefix |
| `naming/test-contracts-suffix` | warn | no | test contracts must end with `Tests` or `TestBase` |
| `structure/section-header-format` | error | yes | section headers must be 100 chars total |
| `structure/modifier-order` | error | no | modifier order: `nonReentrant` before `onlyRole` |
| `structure/setup-external` | warn | no | `setUp()` must be `external` |
| `patterns/require-custom-errors` | warn | no | prefer custom errors over string literals |
| `patterns/storage-location-suffix` | warn | no | storage location constants must end with `_LOCATION` |
| `patterns/erc7201-getter-dollar` | error | no | ERC-7201 getter must return `$` |
| `patterns/event-indexed-key` | warn | no | `bytes32 key/role` event params must be indexed |
| `ordering/interface-members-alphabetical` | warn | no | interface members alphabetical within each section |
| `ordering/constructor-args-alphabetical` | warn | no | constructor arguments must be alphabetical |
| `ordering/contract-section-order` | warn | no | contract preamble sections in canonical order |

### Formatter-only normalisations (no lint rule)

These are applied by `weld format` but are not separately reported by `weld lint`:

| Normalisation | Description |
|---|---|
| `mapping (` spacing | `mapping(` / `mapping  (` → `mapping (` (single space, dss/Sky house style) |
| Line wrap at 120 | over-length function/event/error declarations are split; wrapped ones collapse only when ≤ 90 |
| struct/field comment alignment | trailing `//` comments on a run of typed fields align into a column when 2+ are present |
| consecutive call alignment | runs of same-callee single-line calls align their argument columns (source files only; not `.t.sol`) |
| struct-literal colon | named-argument blocks aligned as `key : value` (space before the colon) |
| type/modifier columns | declaration `type` and modifier (e.g. `indexed`) aligned as two columns |
| require alignment | error column aligned; operands aligned only when all conditions share one operator |
| trailing whitespace | stripped from every line |
| end-of-file | exactly one terminating newline (no trailing blank lines) |
| line comments | `//text` → `// text` (skips `///`, `//!`, banners, strings, URLs) |
| blank after pragma | one blank line between `pragma` and the first import |
| import brace spacing | `import {Foo}from` → `import { Foo } from` (gap before `from` preserved for alignment) |
| multi-line imports | a `import { … }` block is isolated by a blank line on each side |
| decl body blanks | blank line after a contract/interface/library `{` and before its `}` (source files) |
| member separation | blank line between glued member declarations (source files) |
| blank-line cap | at most one consecutive blank line (source files) |
| complex-modifier signatures | when params are wrapped and a complex modifier is present, each modifier goes on its own line |
| modifier order | `nonReentrant` reordered before `onlyRole(...)`; `override` after `view`/`pure`/`payable` |
| event/error explode | packed multi-line event/error params → one parameter per line |
| NatSpec blocks | multi-tag `///` runs → `/** */`; `@param`/`@return` name columns aligned; ` - ` separators stripped |
| boolean wrap | leading `\|\|`/`&&` continuations → trailing operator |
| ternary return | wrapped `return <cond> ? … : …` → `return` alone, condition +4, `?`/`:` +8 |

### Usage

`weld` is a CLI. Install it once from this package, then run it from any project:

```sh
# one-time install (from the weld package dir)
npm install && npm run build && npm link   # makes `weld` available on your PATH

# per-project setup (optional)
weld init                                   # writes weld.config.json (format knobs + rule severities)
```

```sh
# everyday use (uses weld.config.json found by walking up from the cwd)
weld lint                 # lint configured include globs
weld fmt                  # auto-format in place (alias of `weld format`)
weld fmt --check          # dry-run (exit 1 if anything would change)
weld rules                # list rules and their effective severities

# target specific files / rules
weld lint "src/facets/**/*.sol" --errors-only
weld lint "src/**/*.sol" --rules "naming/interface-i-prefix,structure/section-header-format"
weld fmt "src/facets/aave/AaveFacet.sol"
```

Without `npm link`, invoke via `node /path/to/weld/dist/index.js <command>` (this is what the
consuming repo's Makefile does: `node ../weld/dist/index.js …`).

#### Configuration (`weld.config.json`)

`weld init` writes a config you can edit. `solidity` sets language expectations: `spdx` (required
SPDX identifier — e.g. `"AGPL-3.0-or-later"`, `"BUSL-1.1"`, or `null` to accept any) and `pragma`
(required version string — e.g. `"^0.8.34"`, `"0.8.30"`). `format` knobs: `lineLength` (wrap, default
120), `collapseLength` (default 90), `sectionHeaderLength` (default 100), `mappingSpace` (default
true). `lint.rules` maps each rule to `error` | `warn` | `off`. `include` / `exclude` set default globs.

The file carries a `"version"` — a **semver string** for the weld release that wrote it (prereleases
like `1.0.0-rc.1` supported). On upgrade, a config from an older release is migrated in-memory (with a
notice) via a version-keyed forward graph of migrations; run `weld migrate` to persist it.
`weld migrate --check` reports whether a schema migration is pending (exit 1 if so). A config from a
newer weld is left untouched with a warning. See the README for details.

#### Supply-chain hardening

Dependencies are **pinned to exact versions** (no `^`/`~`) and `.npmrc` sets `save-exact=true`, so
new installs can't silently pull a different version. `package-lock.json` (with integrity hashes) is
committed — install with **`npm ci`** to get a reproducible, hash-verified dependency tree.
