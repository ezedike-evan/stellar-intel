from enum import Enum

class IntentRequestType(str, Enum):
    OFFRAMP = "offramp"

    def __str__(self) -> str:
        return str(self.value)
