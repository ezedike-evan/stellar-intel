// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract OnchainOracle {
    address public owner;

    struct CorridorData {
        uint256 volume; // cumulative executed volume (in smallest units)
        uint256 savings; // cumulative fees saved (in smallest units)
        uint256 lastUpdated; // timestamp
    }

    mapping(bytes32 => CorridorData) public corridors;

    event CorridorUpdated(bytes32 indexed corridor, uint256 volume, uint256 savings, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    // Update a single corridor
    function updateCorridor(bytes32 corridor, uint256 volume, uint256 savings) external onlyOwner {
        CorridorData storage c = corridors[corridor];
        c.volume += volume;
        c.savings += savings;
        c.lastUpdated = block.timestamp;
        emit CorridorUpdated(corridor, c.volume, c.savings, c.lastUpdated);
    }

    // Update multiple corridors in batch
    function updateBatch(bytes32[] calldata corridorsKeys, uint256[] calldata volumes, uint256[] calldata savings) external onlyOwner {
        require(corridorsKeys.length == volumes.length && volumes.length == savings.length, "length mismatch");
        for (uint256 i = 0; i < corridorsKeys.length; i++) {
            bytes32 key = corridorsKeys[i];
            CorridorData storage c = corridors[key];
            c.volume += volumes[i];
            c.savings += savings[i];
            c.lastUpdated = block.timestamp;
            emit CorridorUpdated(key, c.volume, c.savings, c.lastUpdated);
        }
    }

    // Read helpers
    function getCorridor(bytes32 corridor) external view returns (uint256 volume, uint256 savings, uint256 lastUpdated) {
        CorridorData storage c = corridors[corridor];
        return (c.volume, c.savings, c.lastUpdated);
    }
}
