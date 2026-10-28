"""Typed errors for the engineering pipeline."""


class DraftyError(Exception):
    """Base error. The message is safe to show to the user."""


class InputError(DraftyError):
    """The design specification is incomplete or physically invalid."""


class GeometryError(DraftyError):
    """The CAD solid or the mesh does not match the specification."""


class SolverError(DraftyError):
    """CalculiX did not produce a usable result."""


class Cancelled(DraftyError):
    """The job was cancelled between stages."""
