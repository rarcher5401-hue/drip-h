// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title DripHFaucet
/// @notice Reserve-backed DRIPH staking with an O(1) cumulative reward index.
///         Principal is reserved before rewards are funded, so a reward claim
///         cannot consume tokens required for principal withdrawals.
contract DripHFaucet {
    IERC20 public immutable token;

    uint256 public immutable baseRatePerSecond;
    uint256 public immutable depositTaxBps;
    uint256 public immutable withdrawTaxBps;

    uint256 public constant DAY = 86400;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant RATE_BUFFER_DAYS = 10;

    struct User {
        uint256 principal;
        uint256 totalRewarded;
        uint256 claimed;
        uint256 compounded;
        uint256 lastUpdate;
        bool hasDeposited;
        uint256 rewardPerTokenPaid;
        uint256 claimable;
    }

    mapping(address => User) public users;
    address[] private stakers;

    uint256 public totalDeposits;
    uint256 public totalStakers;
    uint256 public totalPrincipal;
    uint256 public totalRewardLiability;
    uint256 public distributed;
    uint256 public totalClaimed;

    uint256 public rewardPerTokenStored;
    uint256 public lastGlobalUpdate;
    uint256 public accountedBalance;

    uint256 private unlocked = 1;

    event Deposit(address indexed user, uint256 amount);
    event Compound(address indexed user, uint256 amount);
    event Claim(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount);
    event DonationsSynced(uint256 amount);

    modifier nonReentrant() {
        require(unlocked == 1, "Drip H: reentrant call");
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(
        address token_,
        uint256 dailyRateWad,
        uint256 depositTaxBps_,
        uint256 withdrawTaxBps_
    ) {
        require(token_ != address(0), "Drip H: zero address");
        require(dailyRateWad > 0 && dailyRateWad < 5e16, "Drip H: invalid rate");
        require(depositTaxBps_ <= 2000 && withdrawTaxBps_ <= 2000, "Drip H: tax too high");

        token = IERC20(token_);
        baseRatePerSecond = dailyRateWad / DAY;
        require(baseRatePerSecond > 0, "Drip H: rate too low");
        depositTaxBps = depositTaxBps_;
        withdrawTaxBps = withdrawTaxBps_;
        lastGlobalUpdate = block.timestamp;
    }

    // ---------- reserve and rate ----------

    /// @notice Tokens currently free after reserving every principal token and
    ///         every indexed, unpaid reward. This is the only reward budget.
    function rewardHeadroom() public view returns (uint256) {
        uint256 committed = totalPrincipal + totalRewardLiability;
        return accountedBalance > committed ? accountedBalance - committed : 0;
    }

    function _rateForHeadroom(uint256 headroom) internal view returns (uint256) {
        if (totalPrincipal == 0 || headroom == 0) return 0;

        uint256 target = (totalPrincipal * baseRatePerSecond * DAY * RATE_BUFFER_DAYS) / WAD;
        if (target == 0 || headroom >= target) return baseRatePerSecond;
        return (baseRatePerSecond * headroom) / target;
    }

    function _previewGlobalAccrual() internal view returns (uint256 indexIncrease, uint256 reward) {
        if (totalPrincipal == 0 || block.timestamp <= lastGlobalUpdate) return (0, 0);

        uint256 headroom = rewardHeadroom();
        uint256 rate = _rateForHeadroom(headroom);
        if (rate == 0) return (0, 0);

        uint256 elapsed = block.timestamp - lastGlobalUpdate;
        uint256 requested = (totalPrincipal * rate * elapsed) / WAD;
        if (requested > headroom) requested = headroom;

        indexIncrease = (requested * WAD) / totalPrincipal;
        reward = (indexIncrease * totalPrincipal) / WAD;
    }

    function _checkpoint() internal {
        (uint256 indexIncrease, uint256 reward) = _previewGlobalAccrual();
        if (reward > 0) {
            rewardPerTokenStored += indexIncrease;
            totalRewardLiability += reward;
            distributed += reward;
        }
        lastGlobalUpdate = block.timestamp;
    }

    function _accrueUser(address who) internal returns (uint256 earned) {
        User storage u = users[who];
        uint256 delta = rewardPerTokenStored - u.rewardPerTokenPaid;
        if (u.principal > 0 && delta > 0) {
            earned = (u.principal * delta) / WAD;
            if (earned > 0) {
                u.claimable += earned;
                u.totalRewarded += earned;
            }
        }
        u.rewardPerTokenPaid = rewardPerTokenStored;
        u.lastUpdate = block.timestamp;
    }

    /// @notice Effective rate after accounting for rewards accrued up to now.
    function dailyRate() public view returns (uint256) {
        (, uint256 pending) = _previewGlobalAccrual();
        uint256 headroom = rewardHeadroom();
        if (pending >= headroom) return 0;
        return _rateForHeadroom(headroom - pending) * DAY;
    }

    // ---------- views ----------

    function pendingRewards(address who) public view returns (uint256) {
        User storage u = users[who];
        (uint256 indexIncrease,) = _previewGlobalAccrual();
        uint256 index = rewardPerTokenStored + indexIncrease;
        uint256 newlyEarned = u.principal > 0
            ? (u.principal * (index - u.rewardPerTokenPaid)) / WAD
            : 0;
        return u.claimable + newlyEarned;
    }

    function totalOutstanding() external view returns (uint256) {
        return totalRewardLiability;
    }

    function pendingObligation() external view returns (uint256) {
        (, uint256 pending) = _previewGlobalAccrual();
        return pending;
    }

    function poolObligation() external view returns (uint256 outstanding, uint256 pending) {
        outstanding = totalRewardLiability;
        (, pending) = _previewGlobalAccrual();
    }

    function stakerAt(uint256 i) external view returns (address) {
        return stakers[i];
    }

    // ---------- funding ----------

    /// @notice Add reward backing without creating principal or reward debt.
    function fundRewards(uint256 amount) external nonReentrant {
        require(amount > 0, "Drip H: amount");
        _checkpoint();
        _pullExact(msg.sender, amount);
        accountedBalance += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    /// @notice Recognize tokens sent directly to this contract. Rewards are
    ///         checkpointed first, so a donation cannot reprice elapsed time.
    function syncDonations() external nonReentrant returns (uint256 added) {
        _checkpoint();
        uint256 actual = token.balanceOf(address(this));
        require(actual >= accountedBalance, "Drip H: balance deficit");
        added = actual - accountedBalance;
        accountedBalance = actual;
        if (added > 0) emit DonationsSynced(added);
    }

    // ---------- user actions ----------

    function deposit(uint256 amount) external nonReentrant returns (uint256 net) {
        require(amount > 0, "Drip H: amount");
        net = amount - (amount * depositTaxBps) / BPS;
        require(net > 0, "Drip H: nothing after tax");

        _checkpoint();
        _accrueUser(msg.sender);
        _pullExact(msg.sender, amount);

        User storage u = users[msg.sender];
        if (!u.hasDeposited) {
            u.hasDeposited = true;
            stakers.push(msg.sender);
            totalStakers += 1;
        }

        u.principal += net;
        totalPrincipal += net;
        totalDeposits += net;
        accountedBalance += amount;

        emit Deposit(msg.sender, net);
    }

    function compound() external nonReentrant returns (uint256 amount) {
        _checkpoint();
        _accrueUser(msg.sender);

        User storage u = users[msg.sender];
        amount = u.claimable;
        require(amount > 0, "Drip H: nothing to compound");

        u.claimable = 0;
        u.compounded += amount;
        u.principal += amount;
        totalRewardLiability -= amount;
        totalPrincipal += amount;

        emit Compound(msg.sender, amount);
    }

    function claim() external nonReentrant returns (uint256 amount) {
        _checkpoint();
        _accrueUser(msg.sender);

        User storage u = users[msg.sender];
        amount = u.claimable;
        require(amount > 0, "Drip H: nothing to claim");
        require(accountedBalance >= totalPrincipal + amount, "Drip H: insufficient liquidity");

        u.claimable = 0;
        u.claimed += amount;
        totalRewardLiability -= amount;
        totalClaimed += amount;
        accountedBalance -= amount;

        _pushExact(msg.sender, amount);
        emit Claim(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant returns (uint256 net) {
        require(amount > 0, "Drip H: amount");
        _checkpoint();
        _accrueUser(msg.sender);

        User storage u = users[msg.sender];
        require(amount <= u.principal, "Drip H: amount");
        net = amount - (amount * withdrawTaxBps) / BPS;

        u.principal -= amount;
        totalPrincipal -= amount;
        accountedBalance -= net;

        _pushExact(msg.sender, net);
        emit Withdraw(msg.sender, net);
    }

    // ---------- exact token movement ----------

    function _pullExact(address from, uint256 amount) internal {
        uint256 beforeBalance = token.balanceOf(address(this));
        require(token.transferFrom(from, address(this), amount), "Drip H: token transfer failed");
        uint256 afterBalance = token.balanceOf(address(this));
        require(afterBalance == beforeBalance + amount, "Drip H: fee-on-transfer unsupported");
    }

    function _pushExact(address to, uint256 amount) internal {
        uint256 beforeContract = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(to);
        require(token.transfer(to, amount), "Drip H: token transfer failed");
        uint256 afterContract = token.balanceOf(address(this));
        uint256 afterRecipient = token.balanceOf(to);
        require(
            beforeContract == afterContract + amount && afterRecipient == beforeRecipient + amount,
            "Drip H: fee-on-transfer unsupported"
        );
    }
}
