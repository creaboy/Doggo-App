import base64
import binascii
import io
from typing import Literal, Optional

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator

Temperament = Literal["friendly", "ok", "not_ok"]


class DogProfile(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    bio: str = Field(default="", max_length=240)
    age_months: int = Field(ge=0, le=360)
    dogs: Temperament
    adults: Temperament
    children: Temperament
    photo_jpeg: Optional[str] = Field(default=None, max_length=1_000_000)
    visible: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


def normalize_photo(encoded: str) -> str:
    """Store a small JPEG without metadata from the original photo."""
    try:
        raw = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(raw), formats=["JPEG"]) as image:
            if not 1 <= image.width <= 2048 or not 1 <= image.height <= 2048:
                raise ValueError("La photo est trop grande.")
            image.thumbnail((600, 600))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=83)
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Cette photo n’a pas pu être lue. Choisis une autre image.") from exc
    return base64.b64encode(output.getvalue()).decode("ascii")
