// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DripHToken
/// @notice DRIPH - a simple ERC-20 with an optional transfer fee. Fee-excluded
///         accounts (the faucet, the treasury, the deployer) move tokens
///         freely, so staking and payouts are never double-taxed.
contract DripHToken {
    string public constant name = "Drip H";
    string public constant symbol = "DRIPH";
    uint8 public constant decimals = 18;
    uint256 public constant MAX_SUPPLY = 1_000_000 * 1e18;

    uint256 public totalSupply;
    uint256 public transferFeeBps = 250; // 2.50% on regular transfers
    address public owner;
    address public pendingOwner;
    address public treasury;
    mapping(address => bool) private manualExclusion;
    mapping(address => bool) public exclusionLocked;
    uint256 public lockedExclusionCount;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event FeeUpdated(uint256 bps);
    event Excluded(address indexed account, bool excluded);
    event ExclusionLocked(address indexed account);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "DripHToken: not owner");
        _;
    }

    constructor(address treasury_) {
        require(treasury_ != address(0), "DripHToken: zero address");
        owner = msg.sender;
        treasury = treasury_;
        totalSupply = MAX_SUPPLY;
        balanceOf[owner] = MAX_SUPPLY;
        emit Transfer(address(0), owner, MAX_SUPPLY);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "DripHToken: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function setTransferFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 500, "DripHToken: too high");
        transferFeeBps = bps;
        emit FeeUpdated(bps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "DripHToken: zero address");
        address previous = treasury;
        treasury = treasury_;
        emit TreasuryUpdated(previous, treasury_);
    }

    function setExcluded(address account, bool excluded) external onlyOwner {
        require(account != address(0), "DripHToken: zero address");
        require(account != owner && account != treasury, "DripHToken: role managed");
        require(!exclusionLocked[account], "DripHToken: exclusion locked");
        manualExclusion[account] = excluded;
        emit Excluded(account, excluded);
    }

    function lockExclusion(address account) external onlyOwner {
        require(lockedExclusionCount == 0, "DripHToken: lock already used");
        require(manualExclusion[account], "DripHToken: not excluded");
        exclusionLocked[account] = true;
        lockedExclusionCount = 1;
        emit ExclusionLocked(account);
    }

    function isExcluded(address account) public view returns (bool) {
        return account == owner || account == treasury || manualExclusion[account];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DripHToken: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "DripHToken: not pending owner");
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "DripHToken: zero address");
        require(balanceOf[from] >= amount, "DripHToken: balance");

        uint256 fee = 0;
        if (!isExcluded(from) && !isExcluded(to) && transferFeeBps > 0) {
            fee = (amount * transferFeeBps) / 10000;
        }

        balanceOf[from] -= amount;
        if (fee > 0) {
            balanceOf[treasury] += fee;
            emit Transfer(from, treasury, fee);
        }
        balanceOf[to] += amount - fee;
        emit Transfer(from, to, amount - fee);
    }
}
